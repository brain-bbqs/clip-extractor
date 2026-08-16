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

## The admin-owned dandiset check calls a third party, but without our token

`src/lib/dandisets.ts`'s `listIncomingDandisets` calls a companion service
(not part of this repo, currently hosted on PythonAnywhere) to check whether
a BBQS/EMBER admin co-owns an "Incoming: " dandiset, once per candidate
dandiset on every load of the picker.

That call carries **no credentials of ours**, and it must stay that way. The
service reads the dandiset's owner list from the archive with its own API key
and intersects it with the admin roster it holds server-side, rather than
borrowing the caller's token to do the read. So the request is a bare
unauthenticated `GET` of a dandiset identifier, and the signed-in user's OAuth
token still only ever goes to the archive itself.

An earlier version of this check did forward the user's live access token to
that host on every picker load, which put a credential capable of acting as
the signed-in user on a machine this repo doesn't control. Do not reintroduce
that: if the service ever needs to know something it can't resolve with its
own credentials, change the service, not the header.
`tests/unit/dandisets.test.ts` pins the absence of the `Authorization` header
on this call.

What the design does concentrate is credential custody on the service side:
alongside the roster, that host stores a long-lived archive API key, which is
more powerful than any single user's token, and the account behind it needs
enough read access to see the owner list of every sanctioned "Incoming: "
dandiset (embargoed ones are invisible to non-owners, so in practice that
means an archive superuser or an account co-owning them). That's a deliberate
trade of many transient user tokens transiting a third party for one stored
credential the admins own and can rotate on their own schedule. Before
pointing this at a different or newly-deployed instance of that service,
confirm it is served over HTTPS, that it does not log its API key, the roster,
or the owner lists it reads, and that the key belongs to an account whose only
job is this check.

The residual leak is small and non-identifying: because the endpoint is
unauthenticated, anyone can ask whether a given dandiset identifier is
BBQS-sanctioned. That reveals nothing about who the admins are, grants no
access to embargoed content, and is rate-limited service-side.

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
