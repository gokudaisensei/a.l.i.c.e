# HH — users, household, members, invitations, permissions

Cards for plan §4.3 (`E2E_PARITY_PLAN.md`). Written before `scenarios/hh.ts` (RUNBOOK §6.1).
Oracle: TS, with SPEC/SEC where named.

## Coverage

| Catalogue bullet (plan §4.3) | Cards |
|---|---|
| Profile and preferences (quiet hours, push toggle) | HH-09, HH-10 |
| Household name/timezone | HH-01, HH-02 |
| Members list with presence | HH-03 |
| Role change (A/M/G rules, last admin) | HH-04 |
| Expiry, device visibility | HH-04 (expiry field), **BLOCKED** for visibility (HH-14; DEV area, M4) |
| Remove member (sessions revoked, passkeys gone) | HH-05 |
| Invitations create/list/revoke (code once, role/expiry honoured, one-time use) | HH-06, HH-07, HH-08 (one-time use in AUTH-03) |
| Person ↔ member linking (one person per member, unlink) | **BLOCKED** — needs an HA connection (M3); HH-12 |
| Presence derived from HA `person` changes | **BLOCKED** — needs HA sync (M3); HH-13 |
| Device policies allow/deny; guest needs an allow; guest expiry | **BLOCKED** — DEV/CMD area (M4/M6); HH-14 |
| Sensitive-operation rules | HH-11 |
| Guest visibility on `/devices`, `/ws`, `/activity` | **BLOCKED** — DEV/WS area (M4/M5); HH-14 |

---

### E2E-HH-01  The household summary is the same for every role
- Capability: `GET /household` (API.md)     Oracle: TS
- Needs: household world (admin, member, guest)
- Steps:
  1. admin `GET /household` → 200 `{id,name,timezone,mode,role}` with `role`="admin"
  2. member → 200, same `id`/`name`/`timezone`, `role`="member"
  3. guest → 200, `role`="guest"
  4. anonymous → 401 code `unauthenticated`
- Error twin: step 4
- Normalize: id, timestamps
- Both stacks: yes     Timing: normal     Pass when: the key set and role values match

### E2E-HH-02  Household name/timezone update returns the documented shape
- Capability: `PATCH /household` (API.md)     Oracle: TS, SPEC
- Needs: household world (admin; the registration session is stepped up)
- Steps:
  1. admin `PATCH /household {name:"Parity Home", timezone:"Europe/Berlin"}` → 200 `{id,name,timezone}` (exactly these keys)
  2. `GET /household` → new name and timezone, `mode` still present
  3. admin `PATCH /household {}` → 200 (TS leaves the row unchanged)
- Error twin: `PATCH /household {timezone:"Mars/Olympus"}` → **200 on the oracle** (TS does not check IANA zones; it stores the string); unknown `name` of 81 characters → 4xx `validation_error`
- Normalize: id
- Both stacks: yes     Timing: normal     Pass when: the PATCH response fields, the GET reflection and the name-length error match
- Known caveat: Kotlin validates the timezone and answers 400 `validation_error` where TS accepts it — a stricter Kotlin is still a contract difference and is recorded by the differential suite. Kotlin also requires a recent step-up; a fresh session is stepped up, so the 5-minute lapse is not visible here (AUTH-14). Any extra `mode`/`role` keys in the PATCH reply are a differential failure until accepted.

### E2E-HH-03  Members list shows role, join time and who is me
- Capability: `GET /household/members` (API.md)     Oracle: TS
- Needs: household world
- Steps:
  1. admin `GET /household/members` → 200; three entries with `{id,userId,displayName,avatarColor,role,expiresAt,joinedAt,expired,me}`
  2. exactly one entry has `me:true` (the admin); roles are admin/member/guest; the guest has a non-null `expiresAt` or is marked not expired
  3. member `GET /household/members` → 200 and `me:true` on the member row
  4. guest → 403 code `forbidden` (guests lack `members.view`)
- Error twin: step 4; anonymous → 401
- Normalize: ids, display names are fixed, joinedAt/expiresAt timestamps. Arrays ordered by join time (not sorted before the diff)
- Both stacks: yes     Timing: normal     Pass when: keys, order, `me` flags and the guest refusal match

### E2E-HH-04  Role changes honour the last-admin rule
- Capability: Member role management (FEATURES §People)     Oracle: TS, SPEC
- Needs: household world (admin has a fresh, stepped-up session)
- Steps:
  1. admin `PATCH /household/members/<member id> {role:"guest"}` → 200 `{id,role:"guest",expiresAt}`
  2. member `GET /permissions/me` → `role`="guest" and the guest permission set
  3. admin `PATCH … {role:"member"}` → 200; member `GET /permissions/me` → "member"
  4. admin `PATCH /household/members/<own id> {role:"member"}` → 409 code `conflict` (last admin)
  5. admin `PATCH …/<member id> {expiresAt:<now+3600_000>}` → 200, `expiresAt` echoed; then `{expiresAt:null}` → `expiresAt:null`
- Error twin: step 4; `{role:"owner"}` → 4xx `validation_error`
- Normalize: ids, expiresAt timestamps
- Both stacks: yes     Timing: normal     Pass when: the role transitions, last-admin refusal and expiry echo match

### E2E-HH-05  Removing a member ends their session and passkeys
- Capability: Member removal (plan §4.3)     Oracle: TS, SEC
- Needs: household world
- Steps:
  1. `GET /household/members` as admin → take the member's member id
  2. admin `DELETE /household/members/<member id>` → 200 `{ok:true}`
  3. member's existing cookie `GET /auth/session` → 401
  4. member's passkey `POST /auth/login/options` + assert + verify → 401 code `invalid_credentials`
  5. `GET /household/members` → the member row is gone
  6. admin `DELETE /household/members/<own id>` → 409 `conflict` (last admin)
- Error twin: steps 3, 4, 6
- Normalize: ids, cookie values, timestamps
- Both stacks: yes     Timing: normal     Pass when: the session/passkey are unusable and the last admin cannot be removed

### E2E-HH-06  Invitation creation shows the code once with role and guest window
- Capability: `POST /household/invitations` (API.md)     Oracle: TS
- Needs: household world (admin fresh session)
- Steps:
  1. admin `POST /household/invitations {role:"member", expiresInHours:24}` → 200 `{invitation:{id,role,expiresAt,guestAccessMs:null}, code}`; code is a non-empty string
  2. `POST /household/invitations {role:"guest", guestAccessHours:48}` → `invitation.guestAccessMs` = 48×3 600 000
  3. a second `GET /household/invitations` never contains the plain `code`
- Error twin: `{role:"owner"}` → 422 code `validation_error`; `{role:"member", expiresInHours:0}` → 422 `validation_error`
- Normalize: ids, codes, expiresAt
- Both stacks: yes     Timing: normal     Pass when: the nested invitation shape and code-once rule match
- Known caveat: Kotlin returns the invitation flat and omits `guestAccessMs` in the source read on 2026-11-12; expect a differential finding, not a pass.

### E2E-HH-07  Invitation list exposes the fields the UI needs
- Capability: `GET /household/invitations` (API.md)     Oracle: TS
- Needs: household world; create one member and one guest invitation first
- Steps:
  1. admin creates both invitations (as HH-06, but only ids matter)
  2. `GET /household/invitations` → 200, both present
  3. each entry has `{id,role,expiresAt,createdAt}`; the guest entry also has `guestAccessMs`; `code` and `codeHash` never appear
  4. arrays are newest-created first or in a stable order; compare in order
- Error twin: guest → 403 `forbidden`; anonymous → 401
- Normalize: ids, timestamps
- Both stacks: yes     Timing: normal     Pass when: the field set and order match
- Known caveat: Kotlin's `InvitationResponse` carries only `id, role, expiresAt, createdAt` in the source read; expect a differential finding.

### E2E-HH-08  A revoked invitation disappears and cannot be reused
- Capability: Invitation revoke (plan §4.3)     Oracle: TS
- Needs: household world
- Steps:
  1. create a member invitation → id
  2. `DELETE /household/invitations/<id>` → 200 `{ok:true}`
  3. `GET /household/invitations` → the id is absent
  4. register options with the revoked code → 400 `invalid_invitation`
  5. `DELETE` the same id again → the oracle answers 200 `{ok:true}` (its revoke re-stamps `revokedAt`); Kotlin answers 404 — recorded as a difference
- Error twin: step 4
- Normalize: ids, codes, timestamps
- Both stacks: yes     Timing: normal     Pass when: revoke is immediate and the reused code is refused

### E2E-HH-09  Profile update returns the documented fields
- Capability: `GET/PATCH /users/me` (API.md)     Oracle: TS
- Needs: household world
- Steps:
  1. member `GET /users/me` → 200 `{id,displayName,avatarColor,locale,role}`
  2. member `PATCH /users/me {displayName:"Parity Member Two", avatarColor:7, locale:"de-DE"}` → 200; TS returns `{id,displayName,avatarColor,locale}` (no `role`)
  3. `GET /users/me` → the same values, role unchanged
- Error twin: `{avatarColor:13}` → 422 `validation_error`; `{displayName:""}` → 400 `validation_error`
- Normalize: id
- Both stacks: yes     Timing: normal     Pass when: the PATCH shape and the validation status/code match
- Known caveat: Kotlin's `UserResponse` includes `role` in PATCH as well; expect a differential finding.

### E2E-HH-10  Preferences default and round-trip
- Capability: Quiet hours and push toggle (FEATURES §People)     Oracle: TS
- Needs: household world
- Steps:
  1. member `GET /users/me/preferences` → 200 `{userId, quietHours:null, pushEnabled:true, extra:null}`
  2. `PATCH /users/me/preferences {quietHours:{enabled:true,from:"22:00",to:"07:00"}, pushEnabled:false, extra:{theme:"dark"}}` → 200, fields echoed
  3. `GET` again → the same object
  4. `PATCH {quietHours:null}` → 200 and `quietHours` is null/absent
- Error twin: `{pushEnabled:"yes"}` → 422 `validation_error`
- Normalize: userId
- Both stacks: yes     Timing: normal     Pass when: the default, the round trip and null handling match
- Known caveat: Kotlin's patch model cannot distinguish absent from explicit null on every field; a difference is a finding.

### E2E-HH-11  Permissions and sensitive-operation rules
- Capability: `GET /permissions/me`, `/permissions/policies`, `/admin/security/sensitive-operations` (API.md)     Oracle: TS, SEC
- Needs: household world
- Steps:
  1. admin/member/guest `GET /permissions/me` → role and the exact permission set (compare as a sorted set)
  2. admin `GET /admin/security/sensitive-operations` → 200 `{rules:[…]}`; each rule has `{domain,action,sensitive}` (plus optional `deviceClass`)
  3. admin `PUT /admin/security/sensitive-operations {rules:[{domain:"lock",action:"unlock",sensitive:true}]}` → 200; `GET` shows the rule
  4. member `PUT` the same → 403 `forbidden`; guest `GET` → 403
- Error twin: step 4; `{rules:[{domain:1}]}` → 4xx `validation_error`
- Normalize: ids
- Both stacks: yes     Timing: normal     Pass when: permission sets, rule shape and role refusals match

### E2E-HH-12  BLOCKED — person ↔ member linking
- Capability: `GET/PUT /household/people` (plan §4.3)     Oracle: TS, HA
- Why blocked: linking validates against HA's `person.*` entities; the M2 stack has no HA connection, so there is nothing to link to. The route/shape part is still exercised indirectly by HH-01…HH-11; the link rules run in M3.
- Planned in: M3 (HA) with the seeded `person.parity_*` entities
- Both stacks: yes     Timing: normal     Pass when: run in M3

### E2E-HH-13  BLOCKED — presence from an outside HA person change
- Capability: Presence derived from HA (plan §4.3)     Oracle: HA, TS
- Why blocked: needs the backend connected to HA-A and a state change made directly in HA; the M2 capability suite does not attach HA (M3).
- Planned in: M3
- Both stacks: yes     Timing: normal     Pass when: run in M3

### E2E-HH-14  BLOCKED — guest device visibility and device policies
- Capability: Device policies and guest visibility (plan §4.3, §4.5)     Oracle: SEC, TS
- Why blocked: allow/deny policies act on synced Things; without an HA connection and the seeded entities (M3/M4) there is no device to hide.
- Planned in: M4 (DEV) / M6 (policy effects on commands)
- Both stacks: yes     Timing: normal     Pass when: run in M4
