# AUTH — authentication and sessions

Cards for plan §4.2 (`E2E_PARITY_PLAN.md`). Written before `scenarios/auth.ts` (RUNBOOK §6.1).
Oracle: TS unless a step names SPEC or SEC. All cards run on both stacks in the same order; the
differential runner compares normalized transcripts, so a Kotlin difference is recorded even when
the card's own assertion is loose.

## Coverage

| Catalogue bullet (plan §4.2) | Cards |
|---|---|
| Setup code and first-user registration; household created; recovery codes once | AUTH-01 |
| Invited-user registration: wrong, reused, role honoured | AUTH-02, AUTH-03 |
| Invited-user registration: expired | **not testable now** — minimum invite lifetime is 1 h and no clock knob exists on TS (AUTH-03 caveat) |
| Login options/verify | AUTH-04 |
| Wrong origin / rpId | AUTH-05 |
| Challenge replay | AUTH-06 |
| Challenge expiry | **BLOCKED** — `CHALLENGE_TTL_MINUTES` is Kotlin-only (AUTH-14) |
| Logout | AUTH-07 |
| `GET /auth/session` | AUTH-01, AUTH-04 |
| List and revoke sessions | AUTH-08 |
| Session TTL | **BLOCKED** — slow tier (M8); TS has no TTL knob (AUTH-14) |
| Cookie attributes | AUTH-04 |
| CSRF/SameSite check | AUTH-09 (the `/ws` half is M5, WS cards) |
| Step-up: fresh assertion, wrong user | AUTH-12 |
| Step-up: expiry | **BLOCKED** — 5-minute lapse, slow tier (AUTH-14) |
| Add/list/delete passkeys; last passkey cannot be deleted | AUTH-11 |
| Recovery-code sign-in: single use, restricted session | AUTH-10 |
| Per-account lockout and rate limits | AUTH-13 |
| Revoke-all on credential change | **BLOCKED** — neither backend revokes sibling sessions on passkey change (source-read; AUTH-15) |
| UV-required policy | **BLOCKED** — `REQUIRE_UV_AT_LOGIN` exists in Kotlin only; no TS oracle (AUTH-15) |

---

### E2E-AUTH-01  First user registers with the setup code and receives recovery codes once
- Capability: Passkey sign-in and recovery codes (FEATURES §People); API.md "Authentication" register     Oracle: SPEC, TS
- Needs: fresh stack, no users, `SETUP_CODE=<run code>`
- Steps:
  1. `GET /api/v1/auth/setup` (public) → 200 `{needsSetup:true, setupCodeRequired:true}`
  2. `POST /api/v1/auth/register/options {displayName:"Parity Admin", setupCode:"<wrong>"}` → 403 code `setup_code_required`; setup state unchanged
  3. same with the real code → 200, body has `challengeId` (string), `options.challenge`, `options.rp.id`="localhost", `options.user.name`
  4. software authenticator creates the credential for that challenge; `POST /auth/register/verify` → 200; `recoveryCodes` is a non-empty array of unique strings; `household.role`="admin"; Set-Cookie `alice_session` (HttpOnly, SameSite=Lax)
  5. `GET /auth/session` with that cookie → 200, `restricted:false`, `steppedUp:true`, `household.role`="admin"
  6. `GET /auth/setup` again → 200 `{needsSetup:false, setupCodeRequired:false}`
- Error twin: `POST /auth/register/verify` again with the identical `challengeId`/`response` body → 4xx code `invalid_challenge`
- Normalize: `user.id`, `household.id`, challenge, recovery codes, cookie value, timestamps
- Both stacks: yes     Timing: normal     Pass when: statuses, field presence/types and the admin role match, and codes are returned exactly once
- Known caveat: recovery-code count is read from the TS response, not hard-coded

### E2E-AUTH-02  A second person needs an invitation and a bad code is refused uniformly
- Capability: Invitation-only join (FEATURES §People)     Oracle: TS, SPEC
- Needs: household world (admin registered)
- Steps:
  1. anonymous `POST /auth/register/options {displayName:"No Invite"}` → 403 code `invite_required`
  2. anonymous `POST /auth/register/options {displayName:"Bad Code", inviteCode:"WRONGCODE"}` → 400 code `invalid_invitation`
  3. admin `POST /household/invitations {role:"member"}` → code present; then the new user registers with it → 200, `household.role`="member"
- Error twin: step 2 is the error twin; both errors must carry the envelope, never a different code
- Normalize: ids, invitation code, timestamps; error messages are compared literally (they are user-visible)
- Both stacks: yes     Timing: normal     Pass when: refusals and the member role match exactly
- Known caveat: "expired" is not exercised (see coverage table)

### E2E-AUTH-03  An invitation code is single-use and its role is honoured
- Capability: Invitations shown once, role honoured (FEATURES §People)     Oracle: TS, SPEC
- Needs: household world
- Steps:
  1. admin creates a `guest` invitation with `guestAccessHours:48` → `code` (string)
  2. new user registers with it → 200, `household.role`="guest"
  3. `GET /household` as that guest → 200 `role`="guest"
  4. reuse the same code for another display name → 400 code `invalid_invitation`
- Error twin: step 4
- Normalize: ids, codes, timestamps
- Both stacks: yes     Timing: normal     Pass when: role and single-use behaviour match

### E2E-AUTH-04  Login sets a session cookie with the documented attributes
- Capability: Login options/verify; cookie attributes (plan §4.2)     Oracle: TS, SPEC, SEC
- Needs: household world
- Steps:
  1. `POST /auth/login/options {}` (anonymous) → 200, `challengeId`, `options.challenge`
  2. authenticator asserts with the member's passkey; `POST /auth/login/verify` → 200, body has `user.id`, `household.id`, `expiresAt`
  3. response Set-Cookie: name `alice_session`, `HttpOnly`, `SameSite=Lax`, `Path=/`, `Max-Age` or `Expires` present (compared in whole minutes)
  4. `GET /auth/session` → 200, same user, `restricted:false`
- Error twin: verify a challenge with a passkey the server has never registered (sign-in is usernameless, so any registered passkey may answer) → 4xx `invalid_credentials`
- Normalize: ids, cookie value, challenge, timestamps; cookie attributes compared structurally
- Both stacks: yes     Timing: normal     Pass when: status, cookie attribute set and session shape match

### E2E-AUTH-05  A wrong origin or rpId is refused
- Capability: WebAuthn origin/rpId binding (plan §4.2)     Oracle: TS, SEC
- Needs: household world
- Steps:
  1. login/options → assert with `origin:"http://evil.example"` (same rpId) → 4xx code `invalid_credentials`
  2. new options → assert with correct origin but `rpId:"evil.example"` → 4xx code `invalid_credentials`
  3. new options → correct assertion → 200
- Error twin: steps 1–2
- Normalize: ids, challenges, cookies, timestamps
- Both stacks: yes     Timing: normal     Pass when: both bad assertions are refused with the same code and a good one still signs in

### E2E-AUTH-06  A challenge cannot be replayed
- Capability: Challenge single-use (plan §4.2)     Oracle: TS, SEC
- Needs: household world
- Steps:
  1. login/options for the member → assert → verify → 200
  2. repeat `POST /auth/login/verify` with the identical body → 4xx code `invalid_challenge`
- Error twin: step 2
- Normalize: ids, challenges, cookies, timestamps
- Both stacks: yes     Timing: normal     Pass when: the second use is refused with the same code

### E2E-AUTH-07  Logout clears the cookie and the session
- Capability: Logout (API.md)     Oracle: TS, SEC
- Needs: household world
- Steps:
  1. admin `POST /auth/logout {}` → 200 `{ok:true}`, Set-Cookie clears `alice_session`
  2. `GET /auth/session` with the cleared jar → 401 code `unauthenticated`
  3. `GET /auth/sessions` → 401
- Error twin: step 2
- Normalize: cookie attributes, timestamps
- Both stacks: yes     Timing: normal     Pass when: the session is gone and the cookie is cleared

### E2E-AUTH-08  A user lists their sessions and revokes another one
- Capability: Session list/revoke (plan §4.2)     Oracle: TS, SEC
- Needs: household world
- Steps:
  1. `a = admin.freshSession()` (second sign-in) → both jars valid
  2. `GET /auth/sessions` as each jar → both list the same ids; exactly one entry has `current:true` per caller
  3. `a` revokes the base session id → 200; base `GET /auth/session` → 401
  4. `a` list → only its own session, `current:true`
- Error twin: revoke an unknown session id → 404 `not_found`
- Normalize: ids, timestamps, user-agent, cookie values
- Both stacks: yes     Timing: normal     Pass when: revocation is scoped to the caller's own sessions and immediately effective

### E2E-AUTH-09  A write needs the same-origin and requested-with headers
- Capability: CSRF/SameSite (plan §4.2, `csrf.e2e`)     Oracle: TS, SEC
- Needs: household world (admin signed in)
- Steps:
  1. `POST /auth/logout` with `Origin: http://evil.example` → 403 code `csrf_blocked`
  2. `POST /auth/logout` with no Origin **and no `X-Requested-With`** → 403 `csrf_blocked`
  3. `POST /auth/logout` with the stack origin and `X-Requested-With` → 200
  4. `GET /auth/session` with no Origin → 401 (the session was logged out), not 403
- Error twin: steps 1–2
- Normalize: error messages, timestamps
- Both stacks: yes     Timing: normal     Pass when: the two header failures are refused identically and a same-origin write passes

### E2E-AUTH-10  A recovery code opens a restricted session, once
- Capability: Recovery sign-in (plan §4.2)     Oracle: TS, SEC
- Needs: household world (member's recovery codes from registration)
- Steps:
  1. anonymous `POST /auth/recovery/verify {code:<member code, lower-cased>}` → 200 `restricted:true`, session cookie set
  2. `GET /auth/session` → 200 `restricted:true`, `steppedUp:false`
  3. `GET /auth/passkeys` → 200 (restricted sessions may list/add passkeys)
  4. `GET /household` → 403 code `restricted_session`
  5. repeat step 1 with the same code → 4xx code `invalid_credentials`
- Error twin: steps 4–5
- Normalize: ids, code, cookie value, timestamps
- Both stacks: yes     Timing: normal     Pass when: the restricted window and single use match

### E2E-AUTH-11  Passkeys can be added, listed and deleted; the last one cannot go
- Capability: Passkey management (plan §4.2)     Oracle: TS, SPEC
- Needs: household world (admin signed in, fresh session is stepped up)
- Steps:
  1. `POST /auth/passkeys/options` → 200; register a second authenticator; `POST /auth/passkeys/verify {…,deviceLabel:"parity laptop"}` → 200
  2. `GET /auth/passkeys` → two entries; the new label is present
  3. `DELETE /auth/passkeys/<new id>` → 200; list → one entry
  4. `DELETE /auth/passkeys/<remaining id>` → 409 code `conflict`
- Error twin: delete an unknown id → 404 `not_found`
- Normalize: passkey ids, credential material, timestamps
- Both stacks: yes     Timing: normal     Pass when: the add/list/delete lifecycle and the last-passkey refusal match

### E2E-AUTH-12  Step-up needs a fresh user-verified assertion from the same user
- Capability: Step-up (plan §4.2)     Oracle: TS, SEC
- Needs: household world
- Steps:
  1. member `POST /auth/step-up/options` → 200, `options.userVerification`="required"
  2. assert with `uv:false` → `POST /auth/step-up/verify` → 4xx `invalid_credentials`
  3. new options → assert with `uv:true` → 200 `{steppedUp:true}`; `GET /auth/session` → `steppedUp:true`
  4. new options → verify with the guest's passkey (wrong user) → 4xx `invalid_credentials`
- Error twin: steps 2 and 4
- Normalize: challenges, ids, cookie values, timestamps
- Both stacks: yes     Timing: normal     Pass when: UV-less and wrong-user assertions are refused and a correct one succeeds
- Known caveat: expiry after 5 minutes is slow-tier (AUTH-14). The software authenticator is told to answer even though the guest's credential is not in `allowCredentials`, so the server, not the client, decides the wrong-user refusal.

### E2E-AUTH-13  Public auth calls are rate limited with Retry-After
- Capability: Rate limits (plan §4.2)     Oracle: TS, SEC
- Needs: household world
- Steps:
  1. repeat `POST /auth/login/options {}` (anonymous, no assertion) until a 429 or 40 calls
  2. the 429 body has `error.code`="rate_limited" and a numeric `Retry-After` header
  3. no response before the 429 is a 5xx
- Error twin: the 429 itself
- Normalize: Retry-After seconds bucket (integer), messages
- Both stacks: yes     Timing: normal     Pass when: both backends refuse with 429 + Retry-After within the same bound
- Known caveat: the limit is 30/min per IP, so the base world's 6 auth calls mean the 429 arrives around call 25

### E2E-AUTH-14  BLOCKED — challenge, step-up and session expiry
- Capability: Expiry windows (plan §4.2)     Oracle: SPEC
- Needs: a way to move the clock or a short TTL on **both** backends
- Why blocked: TS has no `CHALLENGE_TTL_MINUTES`, no step-up TTL and no session TTL env; Kotlin has all three. A one-sided knob would compare different code paths, not parity.
- Planned in: slow tier (M8) at real time (challenge expiry, 5-minute step-up lapse, short-TTL session stack)
- Both stacks: yes     Timing: slow-tier     Pass when: run in M8

### E2E-AUTH-15  BLOCKED — revoke-all on credential change and the UV-only policy
- Capability: Credential-change policy; UV-required login (plan §4.2)     Oracle: SPEC
- Why blocked: (a) neither backend revokes sibling sessions when a passkey is added or removed, so there is no oracle behaviour to compare — record as a LIMITATIONS/PARITY question instead; (b) `REQUIRE_UV_AT_LOGIN` exists only in Kotlin, and the TS oracle always asks for `userVerification:"preferred"` at login.
- Both stacks: yes     Timing: normal     Pass when: the plan decides whether these are intended differences
