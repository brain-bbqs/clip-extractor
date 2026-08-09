# Security notes

clip-extractor is a fully static, backend-free page (see `package.json`'s
description) — there is no server to hold a session, set an `httpOnly`
cookie, or otherwise keep a credential out of client-side JavaScript. The
OAuth access/refresh tokens used to call the EMBER-DANDI API have to live
somewhere the browser's JS can read them back out. That constraint doesn't go
away; the sections below are about managing it deliberately instead of by
accident.

These notes intentionally mirror
[bbqs-uploader's `SECURITY.md`](https://github.com/brain-bbqs/bbqs-uploader/blob/main/SECURITY.md);
this app signs in through the same flow against the same archive, so the same
trade-offs apply and are accepted the same way. Keep the two in sync when
either changes.

## The actual risk is XSS, not "clear text storage" by itself

A token sitting in `localStorage`/`sessionStorage` is only exploitable
remotely if an attacker can first get JavaScript to execute on this origin
(XSS) — at which point they could just make authenticated requests directly,
credential theft is a bonus, not the primary damage. So before treating a
"clear text storage of sensitive information" scanner alert as something to
dismiss or work around, actually check whether that precondition holds:

```
grep -rn "innerHTML\|outerHTML\|insertAdjacentHTML" src/
```

For every hit, confirm any _dynamic_ (user-supplied, API-returned, or
otherwise non-literal) string is assigned via `.textContent` (or an
`element.value` type property) rather than concatenated into the HTML string
itself. A fixed, hardcoded template assigned via `innerHTML` is fine — the
risk is interpolating untrusted data into HTML source, not the property name.
As of this writing, both `innerHTML` uses in `src/` are static glyph literals
on the play/pause button in `main.ts`, and every archive-supplied string
(dandiset titles and identifiers, usernames) is rendered through
`.textContent` / `createElement` / `replaceChildren`. Keep it that way — this
is the property that makes accepting client-side token storage a reasonable
call for this app.

Also keep an eye on:

- **Third-party runtime scripts are opt-in only.** `index.html` loads Google
  Analytics' `gtag.js` (see "Google Analytics" below), but only after the
  user explicitly accepts via the consent banner; nothing else loads a CDN
  `<script>` tag. A compromised third-party script is the other realistic way
  a token in storage gets exfiltrated even without a bug in this app's own
  code, so keep the list of scripts that load unconditionally at page load
  empty.
- **Minimal runtime dependencies.** Currently `@talmolab/sleap-io.js`,
  `@ffmpeg/ffmpeg`, and `@ffmpeg/util`. Every added runtime dependency is
  something that could be compromised upstream and ship code that reads
  `localStorage`; don't add one without a reason.

## The admin-owned dandiset check sends the live OAuth token to a third party

`src/lib/dandisets.ts`'s `listIncomingDandisets` calls a companion service
(not part of this repo, currently hosted on PythonAnywhere) to check whether
a BBQS/EMBER admin co-owns an "Incoming: " dandiset, forwarding the
signed-in user's live DANDI OAuth access token in the `Authorization`
header on every load of the picker.

This is a real, deliberate expansion of the trust boundary: otherwise the
token only ever goes to the archive itself. Here it also goes to a
third-party host this repo doesn't control. If that host is compromised,
misconfigured, or just logs request headers by default, a live token capable
of acting as the signed-in user leaks. Before pointing this at a different or
newly-deployed instance of that service, confirm it does not log the
`Authorization` header or the token it extracts from it, and that it's served
over HTTPS.

This is also not a hard access-control boundary even when working correctly:
real upload authorization is still enforced entirely by DANDI's own dandiset
ownership permissions. The service's `adminOwned` answer only curates what
this app's picker shows; it grants no capability on its own. When the service
cannot be reached at all, the check fails closed (the dandiset is not
offered) and the picker says so rather than reporting an empty list as "you
have not been added to any datasets".

## Google Analytics

`index.html` loads GA (`gtag.js`, measurement ID `G-CQZQL50EFX`) gated behind
a cookie-consent banner, copied from the pattern used by
[dandi/usage-page](https://github.com/dandi/usage-page):

- The consent choice (`'accepted'` / `'declined'` / unset) is stored in
  `localStorage` under `clip-extractor.analytics-consent` and re-checked on
  every page load.
- Declining (or leaving the banner unanswered) never fetches `gtag.js`, never
  sets `window.dataLayer`/`window.gtag`, and never touches a GA cookie.
  Accepting is the only path that appends the `gtag.js` `<script>` tag.
- This is not sensitive data: the stored value is a UI preference, not a
  credential, so it doesn't fall under the "clear text storage" checklist
  above.

## Handling a "clear text storage" alert on a new credential

1. Run the `innerHTML`/XSS check above. If it turns up a real
   injection point, fix _that_ — it's a bigger problem than where the token
   sits, and no storage choice below fixes it.
2. If it doesn't, decide how much persistence the credential actually needs,
   in order of decreasing exposure:
   - `localStorage` — survives browser restarts. Lowest friction, largest
     exposure window (persists until explicitly cleared or signed out).
   - `sessionStorage` — survives reloads, clears on tab close. Meaningfully
     smaller window than `localStorage`, but scanners (CodeQL included)
     generally flag this the same way — expect to still need step 3.
   - In-memory only (a plain module variable, no Storage API) — cleared on
     any reload/navigation, not just tab close. Removes the flagged sink
     entirely, at the cost of re-authenticating on every page load.
3. If you land on `localStorage` or `sessionStorage`, dismiss the resulting
   alert as an accepted, documented trade-off (link this file) rather than
   trying to "encrypt" the value client-side first — any decryption key
   reachable by this app's own JS is reachable by an attacker's injected JS
   too, so client-side encryption of a client-held secret is not a real
   mitigation, just a false sense of one.

**Accepted here:** [PR #11](https://github.com/brain-bbqs/clip-extractor/pull/11)
added EMBER sign-in and persists the OAuth token set in `localStorage` under
`clip-extractor.settings.v1` (`saveStoredSettings` in `src/lib/settings.ts`),
so a signed-in session survives a page reload the way it does in
bbqs-uploader. That is the same sink bbqs-uploader carries, accepted here for
the same reasons: the XSS check above is clean, `sessionStorage` would be
flagged identically, and in-memory-only would mean signing in again on every
page load.

**Mechanism note:** this repo runs CodeQL via GitHub's default setup, and an
inline `// codeql[js/clear-text-storage-of-sensitive-data]` comment does
_not_ suppress the alert there (tried in PR #11, commit `100202c`, both on
the flagged line's preceding line and further above). The marker stays in
`src/lib/settings.ts` as documentation of intent, but clearing the check
requires dismissing the alert in the repository's Security tab, which needs
admin rights. Expect to do that, not to fix it in code.

## OAuth token lifecycle

- Access tokens use `django-oauth-toolkit`'s unconfigured default lifetime
  (~10 hours on the EMBER archive, per its settings). `ensureFreshOAuth()` in
  `src/main.ts` refreshes the access token automatically (60s before expiry)
  before each archive call it guards, using the `refresh_token` — so in
  practice a signed-in user isn't prompted to re-authenticate every 10 hours,
  only when the refresh token itself is invalidated, the user explicitly
  signs out (which revokes it via `/oauth/revoke_token/`), or stored settings
  are cleared.
- Sign-in is Authorization Code + PKCE (`src/lib/oauth.ts`) against a public
  client with no secret; the PKCE verifier lives in `sessionStorage` under
  `clip-extractor.oauth-pkce.v1` only between the redirect out and the
  callback back, and the `state` parameter is checked on return before the
  code is exchanged.
- clip-extractor has its own registered OAuth application, separate from
  bbqs-uploader's, so either tool can be revoked without affecting the other.
  Redirect URIs are registered per served location (production, and any
  preview path that needs sign-in); the app computes its own redirect URI at
  runtime from `origin + pathname`.
