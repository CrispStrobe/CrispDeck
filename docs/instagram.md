# Instagram timeline

## Approach

Instagram's supported APIs manage professional accounts, publishing, comments,
and selected discovery features. The official interfaces reviewed for this work
do not provide the signed-in user's home/following timeline. Reading an account's
own media would not satisfy a home-feed feature.

This feature uses the **official Instagram website in a native desktop webview**.
The intended result is a real, interactive, signed-in feed inside CrispDeck, with
Instagram handling login, two-factor authentication, scrolling, and interactions.
Web and mobile builds provide an explicit link to Instagram in the browser.

The feed is a separate website surface. It is not an Instagram API adapter:
Instagram posts do not enter CrispDeck's merged timeline, composer, account
database, crossposting queue, or exports. The same website approach could also
be used for Threads; Instagram does not have a privileged timeline API that
Threads lacks.

## Implementation boundaries

- A dedicated `/instagram` page, discoverable from the sidebar and Deck.
- A desktop child webview fitted to the page, with home, reload, and popout
  controls. A native popup can be placed next to the Deck.
- The fixed entry URL is `https://www.instagram.com/`. Feed selection stays in
  Instagram's own UI; no undocumented Following URL is presented as an API.
- Credentials stay in the browser-managed Instagram session. No password
  collection, cookie import, session extraction, scraping, or private API calls.
- The remote page receives no Tauri capabilities. Native commands validate their
  caller, use fixed labels, and restrict navigation to approved HTTPS sites.
- The native view must hide behind CrispDeck dialogs and close on route changes;
  a stale asynchronous operation must not leave it over another page.
- Session storage behavior and native platform limitations are documented after
  implementation and validation.

## Validation plan

Automated coverage will exercise platform fallback, native dispatch, geometry,
overlay visibility, asynchronous teardown, navigation restrictions, and the new
page. Existing frontend checks and production build must continue to pass.
Native compilation/tests run on the repository's Linux, macOS, and Windows CI.

An authenticated Instagram feed cannot be proven by mocked tests. Before release,
verify login, challenges, scrolling/media, navigation, logout, resizing, overlays,
route changes, and reopening on real desktop builds. Instagram can change its
website or reject a system webview; the external-browser path remains available.

## Primary references

- [Meta's official Instagram API collection](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api)
- [Meta's official Instagram API workspace](https://www.postman.com/meta/instagram/overview)
- [Instagram's description of Home, Following, and Favorites](https://about.fb.com/news/2022/03/two-new-ways-to-control-your-instagram-feed/)
- [Tauri child webviews](https://docs.rs/tauri/2.11.2/tauri/window/struct.Window.html#method.add_child)
- [Tauri capability and remote-origin boundaries](https://v2.tauri.app/security/capabilities/)

The direct Meta developer site was rate limited during research; the API scope
above is based on Meta's official Postman documentation, rather than a claim to
have checked every developer changelog.
