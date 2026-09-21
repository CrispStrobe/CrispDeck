use crate::db::follows::FollowEntry;
use serde::{Deserialize, Serialize};
use strsim::jaro_winkler;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IdentityCandidate {
    pub bluesky_handle: String,
    pub bluesky_display_name: Option<String>,
    pub bluesky_avatar: Option<String>,
    pub bluesky_bio: Option<String>,
    pub bluesky_did: Option<String>,
    pub mastodon_handle: String,
    pub mastodon_display_name: Option<String>,
    pub mastodon_avatar: Option<String>,
    pub mastodon_bio: Option<String>,
    pub mastodon_id: Option<String>,
    pub mastodon_instance: Option<String>,
    pub confidence: f64,
    pub match_reasons: Vec<String>,
}

/// Extract the "username" part of a handle for comparison.
/// "alice.bsky.social" → "alice"
/// "@alice@mastodon.social" → "alice"
fn extract_username(handle: &str) -> String {
    let h = handle.trim_start_matches('@');
    if let Some(at_pos) = h.find('@') {
        h[..at_pos].to_lowercase()
    } else if let Some(dot_pos) = h.find('.') {
        h[..dot_pos].to_lowercase()
    } else {
        h.to_lowercase()
    }
}

/// Check if a bio mentions a handle from the other platform.
///
/// Both sides are compared with and without their @s. The original stripped
/// @ from the handle and not from the bio, so "@alice@mastodon.social" became
/// "alicemastodon.social" and never matched a bio that wrote the handle the
/// ordinary way. That is the usual way to write a Mastodon handle, and a bio
/// cross-reference is the signal identity detection actually depends on — see
/// MATCH_THRESHOLD — so the feature barely fired for Mastodon accounts at all.
fn bio_mentions_handle(bio: &str, other_handle: &str) -> bool {
    let bio_lower = bio.to_lowercase();
    let bio_stripped = bio_lower.replace('@', "");
    let handle_lower = other_handle.to_lowercase();
    let handle_no_leading_at = handle_lower.trim_start_matches('@').to_string();
    let handle_stripped = handle_lower.replace('@', "");

    // As written, without the leading @, and with every @ removed from both
    // sides — so "@alice@mastodon.social" in a bio matches the same handle
    // however either was typed.
    for needle in [&handle_lower, &handle_no_leading_at] {
        if !needle.is_empty() && bio_lower.contains(needle.as_str()) {
            return true;
        }
    }
    if !handle_stripped.is_empty() && bio_stripped.contains(&handle_stripped) {
        return true;
    }

    // Check for the username part
    let username = extract_username(other_handle);
    if username.len() >= 3 {
        // Check for common patterns: "also on bluesky as X", "@X on mastodon", etc.
        let patterns = [
            format!("bsky.social/{}", username),
            format!("bsky.app/profile/{}", username),
            format!("{}.bsky", username),
        ];
        for pat in &patterns {
            if bio_lower.contains(&pat.to_lowercase()) {
                return true;
            }
        }
    }
    false
}

/// How sure we have to be before suggesting two accounts are one person.
///
/// Read this together with the weights below, because together they say
/// something the weights alone do not: 0.5 + 0.3 = 0.8, so display name and
/// username similarity **cannot reach this threshold on their own**, however
/// perfect the match. A bio cross-reference is required in practice.
///
/// That is the conservative choice and it is deliberate. "alex" on Bluesky and
/// "alex" on Mastodon, both displaying "Alex", score 0.80 — and are very
/// probably different people. Telling someone two strangers are the same
/// person is a worse failure than missing a link they can make by hand, so
/// the one signal nobody produces by coincidence — a bio that names the other
/// account — carries the decision.
pub const MATCH_THRESHOLD: f64 = 0.85;

/// Weights. They sum to 1.0, so a perfect match on everything scores exactly
/// 1.0; see MATCH_THRESHOLD for what the first two can reach without the third.
const WEIGHT_DISPLAY_NAME: f64 = 0.5;
const WEIGHT_HANDLE: f64 = 0.3;
const WEIGHT_BIO_CROSSREF: f64 = 0.2;

/// The score for one pair, and why.
///
/// Split out of the loop so it can be tested: this decides whether the app
/// claims two accounts belong to the same person, and it had no tests at all.
pub fn score_pair(bsky: &FollowEntry, masto: &FollowEntry) -> (f64, Vec<String>) {
    let mut score = 0.0;
    let mut reasons = Vec::new();

    // Display name similarity
    if let (Some(bname), Some(mname)) = (&bsky.display_name, &masto.display_name) {
        if !bname.is_empty() && !mname.is_empty() {
            let name_sim = jaro_winkler(&bname.to_lowercase(), &mname.to_lowercase());
            score += WEIGHT_DISPLAY_NAME * name_sim;
            if name_sim > 0.9 {
                reasons.push(format!("display name match ({:.0}%)", name_sim * 100.0));
            }
        }
    }

    // Handle/username similarity
    let bsky_user = extract_username(&bsky.handle);
    let masto_user = extract_username(&masto.handle);
    if !bsky_user.is_empty() && !masto_user.is_empty() {
        let handle_sim = jaro_winkler(&bsky_user, &masto_user);
        score += WEIGHT_HANDLE * handle_sim;
        if handle_sim > 0.9 {
            reasons.push(format!("username match ({:.0}%)", handle_sim * 100.0));
        }
    }

    // Bio cross-reference: the signal nobody produces by coincidence.
    let mut bio_bonus = 0.0;
    if let Some(ref bbio) = bsky.bio {
        if bio_mentions_handle(bbio, &masto.handle) {
            bio_bonus = 1.0;
            reasons.push("Bluesky bio mentions Mastodon handle".to_string());
        }
    }
    if let Some(ref mbio) = masto.bio {
        if bio_mentions_handle(mbio, &bsky.handle) {
            bio_bonus = 1.0;
            reasons.push("Mastodon bio mentions Bluesky handle".to_string());
        }
    }
    score += WEIGHT_BIO_CROSSREF * bio_bonus;

    (score, reasons)
}

#[tauri::command]
pub fn db_detect_identities(
    bsky_follows: Vec<FollowEntry>,
    masto_follows: Vec<FollowEntry>,
) -> Result<Vec<IdentityCandidate>, String> {
    let mut candidates = Vec::new();
    let threshold = MATCH_THRESHOLD;

    for bsky in &bsky_follows {
        for masto in &masto_follows {
            let (score, reasons) = score_pair(bsky, masto);

            if score >= threshold {
                candidates.push(IdentityCandidate {
                    bluesky_handle: bsky.handle.clone(),
                    bluesky_display_name: bsky.display_name.clone(),
                    bluesky_avatar: bsky.avatar_url.clone(),
                    bluesky_bio: bsky.bio.clone(),
                    bluesky_did: bsky.did.clone(),
                    mastodon_handle: masto.handle.clone(),
                    mastodon_display_name: masto.display_name.clone(),
                    mastodon_avatar: masto.avatar_url.clone(),
                    mastodon_bio: masto.bio.clone(),
                    mastodon_id: masto.mastodon_id.clone(),
                    mastodon_instance: masto.instance_url.clone(),
                    confidence: score,
                    match_reasons: reasons,
                });
            }
        }
    }

    // Sort by confidence descending
    candidates.sort_by(|a, b| b.confidence.partial_cmp(&a.confidence).unwrap());

    // Deduplicate: keep the best match per bluesky handle
    let mut seen_bsky = std::collections::HashSet::new();
    let mut seen_masto = std::collections::HashSet::new();
    candidates.retain(|c| {
        let bsky_new = seen_bsky.insert(c.bluesky_handle.clone());
        let masto_new = seen_masto.insert(c.mastodon_handle.clone());
        bsky_new && masto_new
    });

    Ok(candidates)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Deciding that two accounts are one person is a claim about people, and
    /// this file had no tests. These pin what the scoring actually does —
    /// including the part that is easy to miss by reading the weights.

    fn entry(handle: &str, display_name: Option<&str>, bio: Option<&str>) -> FollowEntry {
        FollowEntry {
            platform: "bluesky".to_string(),
            handle: handle.to_string(),
            did: None,
            mastodon_id: None,
            instance_url: None,
            display_name: display_name.map(str::to_string),
            avatar_url: None,
            bio: bio.map(str::to_string),
        }
    }

    fn score_of(bsky: &FollowEntry, masto: &FollowEntry) -> f64 {
        score_pair(bsky, masto).0
    }

    mod the_threshold_cannot_be_reached_on_similarity_alone {
        use super::*;

        #[test]
        fn a_perfect_name_and_handle_match_still_falls_short() {
            // 0.5 + 0.3 = 0.8, and the threshold is 0.85. This is the whole
            // shape of the feature: without a bio cross-reference, nothing
            // qualifies, however identical the accounts look.
            let a = entry("alice.bsky.social", Some("Alice"), None);
            let b = entry("@alice@mastodon.social", Some("Alice"), None);

            let score = score_of(&a, &b);
            assert!((score - 0.8).abs() < 1e-9, "expected 0.8, got {score}");
            assert!(score < MATCH_THRESHOLD, "must not qualify without a bio link");
        }

        #[test]
        fn two_strangers_sharing_a_common_name_do_not_qualify() {
            // The reason the threshold sits above what similarity can reach.
            // "alex" is a common handle and "Alex" a common name; these are
            // probably different people and must not be suggested as one.
            let a = entry("alex.bsky.social", Some("Alex"), None);
            let b = entry("@alex@fosstodon.org", Some("Alex"), None);

            assert!(score_of(&a, &b) < MATCH_THRESHOLD);
        }

        #[test]
        fn short_handles_that_jaro_winkler_rates_highly_still_do_not_qualify() {
            // jaro_winkler("jo", "jon") is above 0.9: short strings share a
            // prefix and the metric rewards that. Without the bio gate this
            // is exactly where false positives would come from.
            let a = entry("jo.bsky.social", Some("Jo"), None);
            let b = entry("@jon@mastodon.social", Some("Jon"), None);

            assert!(score_of(&a, &b) < MATCH_THRESHOLD);
        }
    }

    mod with_a_bio_cross_reference {
        use super::*;

        #[test]
        fn a_strong_match_qualifies() {
            let a = entry("alice.bsky.social", Some("Alice"), None);
            let b = entry(
                "@alice@mastodon.social",
                Some("Alice"),
                Some("also on bluesky: alice.bsky.social"),
            );

            let (score, reasons) = score_pair(&a, &b);
            assert!(score >= MATCH_THRESHOLD, "expected a match, got {score}");
            assert!(reasons.iter().any(|r| r.contains("bio mentions")));
        }

        #[test]
        fn a_bio_link_alone_is_not_enough() {
            // 0.2 for the bio plus a weak name and handle stays under. The
            // cross-reference is necessary, not sufficient.
            let a = entry("someone.bsky.social", None, None);
            let b = entry("@entirely-different@mastodon.social", None, Some("someone.bsky.social"));

            assert!(score_of(&a, &b) < MATCH_THRESHOLD);
        }

        #[test]
        fn it_works_in_either_direction() {
            let bsky_side = entry("alice.bsky.social", Some("Alice"), Some("@alice@mastodon.social"));
            let masto_side = entry("@alice@mastodon.social", Some("Alice"), None);

            assert!(score_of(&bsky_side, &masto_side) >= MATCH_THRESHOLD);
        }
    }

    mod missing_data {
        use super::*;

        #[test]
        fn absent_display_names_lower_the_ceiling_to_half() {
            // Nothing scores for a name that is not there, so the most such a
            // pair can reach is 0.3 + 0.2 = 0.5 — it can never be suggested.
            let a = entry("alice.bsky.social", None, Some("@alice@mastodon.social"));
            let b = entry("@alice@mastodon.social", None, None);

            let score = score_of(&a, &b);
            assert!((score - 0.5).abs() < 1e-9, "expected 0.5, got {score}");
        }

        #[test]
        fn an_empty_display_name_counts_as_absent_rather_than_as_a_match() {
            // Two empty strings are identical, and jaro_winkler would say so.
            // Scoring that as a perfect name match would make every pair of
            // nameless accounts look alike.
            let a = entry("alice.bsky.social", Some(""), None);
            let b = entry("@bob@mastodon.social", Some(""), None);

            let score = score_of(&a, &b);
            assert!(score < 0.5, "empty names must not score as a match, got {score}");
        }
    }

    mod extract_username {
        use super::*;

        #[test]
        fn takes_the_part_before_the_first_dot_or_at() {
            assert_eq!(extract_username("alice.bsky.social"), "alice");
            assert_eq!(extract_username("@alice@mastodon.social"), "alice");
            assert_eq!(extract_username("@alice"), "alice");
            assert_eq!(extract_username("alice"), "alice");
        }

        #[test]
        fn lowercases_so_case_is_not_a_difference() {
            assert_eq!(extract_username("Alice.bsky.social"), "alice");
        }

        #[test]
        fn handles_an_empty_handle_without_panicking() {
            assert_eq!(extract_username(""), "");
            assert_eq!(extract_username("@"), "");
        }
    }

    mod bio_mentions_handle {
        use super::*;

        #[test]
        fn finds_a_plain_handle() {
            assert!(bio_mentions_handle("find me at alice.bsky.social", "alice.bsky.social"));
        }

        #[test]
        fn ignores_case_and_a_leading_at() {
            assert!(bio_mentions_handle("ALSO @Alice@Mastodon.Social", "@alice@mastodon.social"));
        }

        #[test]
        fn recognises_a_profile_url() {
            assert!(bio_mentions_handle("https://bsky.app/profile/alice", "alice.bsky.social"));
        }

        #[test]
        fn does_not_match_an_unrelated_bio() {
            assert!(!bio_mentions_handle("i like trains", "alice.bsky.social"));
        }

        #[test]
        fn a_username_under_three_characters_does_not_trigger_the_url_patterns() {
            // Guarding against a two-letter username matching half the web.
            assert!(!bio_mentions_handle("bsky.social/jo is someone else", "jo.bsky.social"));
        }
    }

    mod the_candidate_list {
        use super::*;

        #[test]
        fn keeps_only_the_best_match_for_each_account() {
            // One Bluesky account cannot be two people. Without the dedupe a
            // user would be asked to confirm several contradictory links.
            let bsky = vec![entry("alice.bsky.social", Some("Alice"), Some("@alice@mastodon.social"))];
            let masto = vec![
                entry("@alice@mastodon.social", Some("Alice"), None),
                entry("@alice@other.social", Some("Alice"), None),
            ];

            let out = db_detect_identities(bsky, masto).unwrap();
            assert!(out.len() <= 1, "one account should yield at most one candidate");
        }

        #[test]
        fn returns_nothing_when_nothing_qualifies() {
            let bsky = vec![entry("alice.bsky.social", Some("Alice"), None)];
            let masto = vec![entry("@bob@mastodon.social", Some("Bob"), None)];

            assert!(db_detect_identities(bsky, masto).unwrap().is_empty());
        }

        #[test]
        fn handles_empty_input_without_panicking() {
            assert!(db_detect_identities(vec![], vec![]).unwrap().is_empty());
        }
    }
}
