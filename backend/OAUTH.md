# Sign in with tokn

An OAuth 2.0 authorization server for desktop apps, so an app can sign someone
in with their tokn account and upload usage for them. The first client is Eaon
Desktop, whose Settings → Usage page uses it.

## The flow

Authorization code with PKCE (S256 only), for public native clients
(RFC 8252). There are no client secrets: an app cannot keep one.

1. The app opens a one-shot server on `127.0.0.1` and sends the browser to
   `GET /oauth/authorize` with `response_type=code`, `client_id`,
   `redirect_uri` (its loopback), `code_challenge`, `code_challenge_method=S256`,
   `state` and an optional `scope`.
2. `/oauth/authorize` is a route, not a page, so it can answer with real
   redirects:
   - an unknown client, or a redirect the client may not use, goes to
     `/oauth/consent`, which shows the problem and never redirects anywhere;
   - any other error goes back to the app's loopback (`error`,
     `error_description`, `state`);
   - signed out goes to `/login?next=…`, and back here after signing in;
   - otherwise, `/oauth/consent`.
3. Someone who creates an account on the way goes through `/welcome?next=…`
   first. The welcome flow names the app that is waiting, and finishing or
   skipping it leads back to step 2.
4. The consent screen posts to `POST /api/oauth/authorize`. That checks the
   `Origin` header (it must be this site) and the session, runs the request
   through `authorizeRequest` again, and answers 303 to the loopback with
   `code` and `state`, or `error=access_denied`.
5. The app calls `POST /api/oauth/token` (form or JSON) with
   `grant_type=authorization_code`, `code`, `redirect_uri`, `client_id`,
   `code_verifier`, and optionally `device_name`, `platform`, `app_version`.
   The reply is `{ access_token, token_type: "Bearer", scope, user, profile_url }`.
6. The access token is an ordinary device token. `/api/cli/me`,
   `/api/cli/sync` and `/api/cli/pricing` accept it unchanged, and it is listed
   under connected machines on `/account` as the app ("Eaon Desktop ·
   hostname"), where revoking it signs the app out.
7. `POST /api/oauth/revoke` (RFC 7009) revokes a token. It always answers 200.

Metadata is at `GET /.well-known/oauth-authorization-server` (RFC 8414).

## Decisions

**Stateless, signed codes.** A code is `toknac_` + base64url(JSON) + `.` +
HMAC-SHA256, valid for two minutes. Nothing is stored when one is issued, so
there is no collection to provision and nothing to clean up.

**Single use comes from the device id.** The device row a code buys has an id
derived from the code (`oa…` with `usage:write`, `op…` without). Redeeming the
same code twice collides on that id, and the second attempt revokes the token
the first one bought (RFC 6749 §4.1.2).

**The signing key needs no configuration.** It is `TOKN_OAUTH_SECRET` when set,
otherwise HKDF-SHA256 of `APPWRITE_API_KEY` with the info string
`tokn-oauth-code-v1`. Rotating either one only invalidates codes in flight.

**Loopback redirects are matched as strings.** `http://127.0.0.1`,
`localhost` or `[::1]`, a port from 1024 to 65535, the client's exact path, and
nothing else. The URL parser is too forgiving to be the check (`127.1`,
`0x7f.0.0.1`, userinfo, trailing dots), so a regex matches first and the parser
must read the string back unchanged.

**Return paths are resolved the way a browser would.** `safeReturnPath` (in
`src/return-path.ts`) is used by every sign-in path that carries `next`, so
`/\evil.com`, control characters and dot-segment tricks cannot become an open
redirect.

## Adding a client

One entry in `OAUTH_CLIENTS` (`src/oauth/clients.ts`): an id, the name people
see, an icon in `web/public/apps/`, its scopes from `OAUTH_SCOPES`, and its
loopback path. The tests in `test/oauth.test.ts` check every client has a name
and an icon.

## Deploying

No new collections, attributes or environment variables. Production needs
`TOKN_PUBLIC_URL` (already set, since passkeys and profile links use it) and
`APPWRITE_API_KEY`.
