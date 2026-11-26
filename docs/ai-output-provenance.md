# AI output disclosure and provenance

CrispDeck records successful uses of its AI compose actions. It keeps these records
alongside the draft, without adding hidden characters or changing the model's output.
This is an application-level transparency improvement, not a statistical watermark,
a signed content credential, or a claim of legal compliance.

## What is recorded

- Grammar correction and shortening are recorded as **AI-assisted** operations on
  the author's text. Shortening can produce a summary or substantive rewrite; this
  classification does not claim that shortening is exempt from marking requirements.
- Suggested hashtags and image descriptions are recorded as **AI-generated
  portions**. The author's entire original post is not described as generated.
- Each record contains an operation, target field (and image index where relevant),
  timestamp, configured endpoint/provider and `requested_model` identifier where suitable, and edit/review
  status. Custom endpoint URLs, API keys, prompts, image data, account identities,
  and absolute local model paths are not included in the provenance fields.
- The export deliberately includes the current draft text and image descriptions.
  Users should review that content before sharing the file.

The provider is inferred from the effective known endpoint, rather than trusting a
possibly stale provider preset selection. Unrecognized OpenAI-compatible endpoints
are identified as `custom-openai-compatible`, without exporting their addresses.
Requested model names can be aliases. The record does not claim to verify the
model actually served behind a provider or gateway.

## Editing and persistence

Records survive autosave, saved/scheduled drafts, the publishing outbox and text
templates. Ordinary edits retain contribution history and invalidate the old review
status. Clearing a field or replacing its entire selection removes that field's old
attribution. A template brings its own body records; image records remain attached to
their images and are removed or reindexed when an attachment is removed.

This is conservative contribution history, not token-by-token authorship detection.
Edits can remove individual generated phrases without deleting all historical AI
involvement. Legacy drafts and imported text with no records remain unclassified;
absence of a record is not proof that content was written by a human. Paste/undo
cannot reconstruct provenance from another application.

Alt-text generation sends the selected image to the chosen vision backend, rather
than asking the model to describe an unseen attachment. A response is not applied if
the target text, image or existing description changed while generation was pending.
Video attachments are not submitted as still images.

## Review, copy and export

The composer shows a review panel for recorded contributions. It can export the
current body, image descriptions and records together as JSON. It provides an
explicit option to copy or add a visible disclosure for a shortened/rewritten body
or generated hashtags. Grammar-only correction does not silently append a public
footer. Review is an explicit user action and is not inferred from opening a draft.

The JSON uses `schema: "crisp-ai-output-record"`, version `1`, with contribution
records in `contributions`. It does not authenticate their truth or prevent removal.
Social-network publish adapters do not receive these private records. Per-account
text overrides can differ from the shared body and are outside the exported AI
record's scope; the composer tells the user to review each destination. Adding a
visible disclosure changes the shared text and its character counts/previews, so
the user can inspect the exact post before publishing. Manual text selection may
omit the records and disclosure. Network transformations and downstream copying
are not guaranteed to preserve them.

Existing translated-post views continue to display the translation provider and
source language. This change does not attribute third-party posts or imported media
to CrispDeck's AI, or invent provenance for existing translation caches.

## Nebius endpoint migration

The preset and effective compose, translation and model-discovery requests now use
[`https://api.tokenfactory.nebius.com/v1`](https://docs.tokenfactory.nebius.com/quickstart).
Only the exact saved legacy bases `https://api.studio.nebius.ai/v1` and
`https://api.studio.nebius.com/v1` (including a trailing slash) are migrated. Custom
hosts, proxy paths, query strings, models and API keys are preserved. Loading an old
configuration normalizes it in memory; the next settings save persists that base.

## Validation

Focused tests cover effective request/model attribution, untouched output strings,
privacy of provenance fields, the distinction between editing and generation,
edit/replacement and attachment lineage, draft/schedule/outbox and template
round-trips, and exact endpoint migration without rewriting custom routes.

```sh
npm test -- src/lib/compose/ai.test.ts src/lib/compose/ai-provenance.test.ts src/lib/compose/ai-draft.test.ts src/lib/byok-providers.test.ts src/lib/translate.providers.test.ts src/lib/translate.test.ts src/lib/publishing/drafts.test.ts src/lib/templates.test.ts
npm run check
```
