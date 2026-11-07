# Instagram timeline

## Approach

Instagram's supported APIs manage professional accounts, publishing, comments,
and selected discovery features. The official interfaces reviewed for this work
do not provide the signed-in user's home/following timeline. Reading an account's
own media would not satisfy a home-feed feature.

This feature uses the **official Instagram website in a native desktop webview**.
The `/instagram` page loads that website inline on Windows/macOS and opens a
dedicated native window on Linux, with Instagram handling login, two-factor
authentication, scrolling, and interactions.
Web and mobile builds provide an explicit link to Instagram in the browser.

The feed is a separate website surface. It is not an Instagram API adapter:
Instagram posts do not enter CrispDeck's merged timeline, composer, account
database, crossposting queue, or exports. The same website approach could also
be used for Threads; Instagram does not have a privileged timeline API that
Threads lacks.

## Implementation boundaries

- A dedicated `/instagram` page, discoverable from the sidebar and Deck.
- A Windows/macOS child webview fitted to the page, with home, reload, and popout
  controls. Linux offers the native window. A popout can be placed next to Deck.
- The fixed entry URL is `https://www.instagram.com/`. Feed selection stays in
  Instagram's own UI; no undocumented Following URL is presented as an API.
- Credentials stay in the browser-managed Instagram session. No password
  collection, cookie import, session extraction, scraping, or private API calls.
- The remote page receives no Tauri capabilities. Native commands validate their
  caller, use fixed labels, and restrict navigation to approved HTTPS sites.
- The native view must hide behind CrispDeck dialogs and close on route changes;
  a stale asynchronous operation must not leave it over another page.

## Using it

1. Open **Instagram** from the sidebar or the Deck toolbar in the desktop app.
2. On Linux, choose **Open in a window**. On Windows/macOS, the inline page opens
   automatically. Sign in on Instagram's own page. Complete any two-factor authentication or
   account verification there. The origin displayed above the view identifies
   the approved website currently being shown.
3. Read and interact through Instagram's controls. Select **Following** in
   Instagram's own menu if it is offered; CrispDeck does not control feed order.
4. Use **Home** to return from a profile or post, **Reload** to retry the current
   page, or **Open in a window** to place Instagram beside the Deck. The popout
   uses the same embedded Instagram session and remains open when changing
   CrispDeck routes.
5. Switch Instagram accounts or sign out using Instagram's own controls. Your
   Mastodon/Bluesky/Threads account picker does not control this website session.

**Open in browser** is available if the system webview does not support a login
flow or website feature. Web/PWA and iOS/Android use this external option. Your
system browser has its own session; CrispDeck does not import that login.

## Native browser and session boundaries

The Windows/macOS embedded feed is a child webview, not an HTML iframe. It requires
Tauri's `unstable` multiwebview feature. The existing main view keeps its full
window sizing; Instagram occupies only the page's measured content rectangle.
It is hidden when clipped, zoomed with a visual viewport transform, or covered
by an app dialog, navigation overlay, menu, or notification. Switching routes
closes the inline view; session ownership prevents late asynchronous cleanup
from touching a replacement view. Native window creation is asynchronous to
avoid the documented Windows WebView2 synchronous-command deadlock.

Linux uses the stable native-window path because the pinned Tauri 2.11.2/Wry
0.55.1 GTK integration does not reliably honor child-webview bounds. The native
capability result distinguishes inline and popout support, and the open command
also rejects an inline Linux request. This avoids a remote view covering the
app's sidebar. See the upstream [multiwebview positioning issue](https://github.com/tauri-apps/tauri/issues/10420)
and [WebKitGTK/Wayland report](https://github.com/tauri-apps/tauri/issues/15656).

Session cookies stay in the browser engine. Windows and Linux use a dedicated
`instagram-web` directory under CrispDeck's application data. macOS 14 and later
use a dedicated persistent WebKit data-store identifier. On macOS 11–13, Wry
falls back to the app's default WebKit store, still separated by website origin;
this is **not a distinct Instagram browser profile** on those older systems.
Do not clear the shared WebKit store to log out; use Instagram's own Log out.

The only permitted top-level destinations are HTTPS on exact Instagram,
Facebook, and their selected Accounts Center hosts. Redirects to arbitrary
sites, local app pages, custom schemes, credential-bearing URLs, and nonstandard
ports are rejected. Approved popup links navigate the managed view, rather than
creating an unmanaged window. File downloads are disabled in the embedded
surface; use the system browser for those flows. Normal media/CDN requests stay
under the browser engine's security rules.

No remote Tauri capabilities were added. Control commands require the local
`main` webview in the `main` window and verify its bundled origin (or the exact
configured development origin in a dev build). The only website information
sent to the main UI is an approved origin, never an authentication path/query.
The application does not read cookies or execute custom scripts inside Instagram.

## Validation plan

Automated coverage exercises platform fallback, native dispatch, geometry,
overlay visibility, asynchronous teardown, navigation restrictions, and the new
page. Native compilation/tests run on the repository's Linux, macOS, and Windows
CI. The browser suite checks the real route and fallback link, while unit tests
mock the native bridge; neither proves an Instagram sign-in works.

An authenticated Instagram feed cannot be proven by mocked tests. Before release,
verify login, challenges, scrolling/media, navigation, logout, resizing, overlays,
route changes, and reopening on real desktop builds. Instagram can change its
website or reject a system webview; the external-browser path remains available.

| Native acceptance check | Status |
| --- | --- |
| Sign in, complete 2FA/challenge, and reach the user's home feed | Pending real account |
| Scroll multiple pages; images, video, carousel and replies | Pending real account |
| Instagram's Following selection, where available | Pending real account |
| Resize, sidebar collapse, dialogs, toasts and route transitions | Pending native runtime |
| Popout, close/reopen, account switching and logout | Pending native runtime/account |
| Relaunch and check session persistence, including older macOS | Pending native runtime/account |

For each check record the commit, OS version, webview engine version, and result.
Do not put account credentials, cookies, private feed captures, or login URLs
into repository artifacts. Keep this feature in review until the relevant
native acceptance checks have been performed.

## Primary references

- [Meta's official Instagram API collection](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api)
- [Meta's official Instagram API workspace](https://www.postman.com/meta/instagram/overview)
- [Instagram's description of Home, Following, and Favorites](https://about.fb.com/news/2022/03/two-new-ways-to-control-your-instagram-feed/)
- [Tauri child webviews](https://docs.rs/tauri/2.11.2/tauri/window/struct.Window.html#method.add_child)
- [Tauri capability and remote-origin boundaries](https://v2.tauri.app/security/capabilities/)
- [Pinned Wry WebKit data-store behavior](https://github.com/tauri-apps/wry/blob/wry-v0.55.1/src/wkwebview/mod.rs)

The direct Meta developer site was rate limited during research; the API scope
above is based on Meta's official Postman documentation, rather than a claim to
have checked every developer changelog.
