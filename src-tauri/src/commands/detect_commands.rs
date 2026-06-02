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
fn bio_mentions_handle(bio: &str, other_handle: &str) -> bool {
    let bio_lower = bio.to_lowercase();
    let handle_lower = other_handle.to_lowercase().replace('@', "");

    // Check for the full handle
    if bio_lower.contains(&handle_lower) {
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

#[tauri::command]
pub fn db_detect_identities(
    bsky_follows: Vec<FollowEntry>,
    masto_follows: Vec<FollowEntry>,
) -> Result<Vec<IdentityCandidate>, String> {
    let mut candidates = Vec::new();
    let threshold = 0.85;

    for bsky in &bsky_follows {
        for masto in &masto_follows {
            let mut score = 0.0;
            let mut reasons = Vec::new();

            // Display name similarity (weight: 0.5)
            if let (Some(bname), Some(mname)) = (&bsky.display_name, &masto.display_name) {
                if !bname.is_empty() && !mname.is_empty() {
                    let name_sim = jaro_winkler(&bname.to_lowercase(), &mname.to_lowercase());
                    score += 0.5 * name_sim;
                    if name_sim > 0.9 {
                        reasons.push(format!("display name match ({:.0}%)", name_sim * 100.0));
                    }
                }
            }

            // Handle/username similarity (weight: 0.3)
            let bsky_user = extract_username(&bsky.handle);
            let masto_user = extract_username(&masto.handle);
            if !bsky_user.is_empty() && !masto_user.is_empty() {
                let handle_sim = jaro_winkler(&bsky_user, &masto_user);
                score += 0.3 * handle_sim;
                if handle_sim > 0.9 {
                    reasons.push(format!("username match ({:.0}%)", handle_sim * 100.0));
                }
            }

            // Bio cross-reference (weight: 0.2)
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
            score += 0.2 * bio_bonus;

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
