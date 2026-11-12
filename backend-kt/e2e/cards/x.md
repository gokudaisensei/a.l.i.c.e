# X — cross-cutting contract

Cards for plan §4.14 (`E2E_PARITY_PLAN.md`). Written before `scenarios/x.ts` (RUNBOOK §6.1).
Oracle: TS for status/shape; SEC for anything that must not leak.

## Coverage

| Catalogue bullet (plan §4.14) | Cards |
|---|---|
| Error envelope on every error, snake_case, no raw HA text | X-01, X-02, X-03 |
| Validation errors use `validation_error` | X-04 |
| ULID and Unix-millisecond conventions | X-01, X-09 (ids and timestamps appear in every transcript; normalizer checks prefix/type) |
| Pagination (`limit`, `cursor`, `nextCursor`) | X-09 |
| OpenAPI/`/docs` presence | **BLOCKED** — no shared oracle; TS exposes `/docs`, Kotlin has no OpenAPI route in the inventory (X-11) |
| CORS: allowed and denied origins, preflight | X-05, X-06 |
| `TRUST_PROXY` behaviour | **BLOCKED** — the harness launch sets no proxy; would need a dedicated stack pair (X-11) |
| Request size limits | **BLOCKED** — no documented limit in either backend; not safe to invent one (X-11) |
| Content-type handling | X-07 |
| 404 on unknown routes | X-01 |
| Method not allowed | X-02 |
| Response headers | X-10 |
| Structured logs: correlation id, no secrets | **BLOCKED** — needs log parsing per stack; no correlation-id contract in API.md (X-11) |
| Additive Kotlin endpoints do not change existing responses | inventory (`only-Kotlin` list); every differential card is the check |

---

### E2E-X-01  An unknown route returns the standard envelope with 404
- Capability: 404 + error envelope (API.md §Errors)     Oracle: TS, SPEC
- Needs: either stack up (no auth)
- Steps:
  1. anonymous `GET /api/v1/definitely-not-a-route` → 404
  2. body is exactly `{error:{code:"not_found",message:…}}` (no extra top-level keys)
  3. `message` is human text, no stack frames, no HA error vocabulary
- Error twin: this is the error card
- Normalize: message is compared literally; timestamps absent
- Both stacks: yes     Timing: normal     Pass when: status, key set and message match

### E2E-X-02  A known path with the wrong method does not fall through silently
- Capability: Method handling (plan §4.14)     Oracle: TS
- Needs: either stack up
- Steps:
  1. anonymous `PUT /api/v1/auth/login/options` (only POST exists) → the TS oracle's status (404 or 405) with an envelope
  2. body has `error.code` and `error.message`
  3. `PATCH /api/v1/auth/setup` → same class of answer
- Error twin: this is the error card
- Normalize: ids, messages compared literally
- Both stacks: yes     Timing: normal     Pass when: the status class and envelope match
- Known caveat: TS (Elysia) and Kotlin (Ktor) may choose 404 vs 405; the difference is a finding until accepted.

### E2E-X-03  Authentication failures use the same envelope as any other error
- Capability: 401 envelope (API.md §Errors, SEC)     Oracle: TS, SEC
- Needs: household world
- Steps:
  1. anonymous `GET /api/v1/household` → 401 `{error:{code:"unauthenticated",message:…}}`
  2. anonymous `GET /api/v1/users/me` → 401 same code
  3. a bogus cookie `alice_session=not-a-session` → 401, not 500
  4. none of the bodies contain a token, cookie value or stack frame
- Error twin: this is the error card
- Normalize: messages compared literally
- Both stacks: yes     Timing: normal     Pass when: the code, status and message are identical

### E2E-X-04  Schema validation is `validation_error` with the same status
- Capability: Validation errors (plan §4.14)     Oracle: TS
- Needs: household world (admin)
- Steps:
  1. admin `POST /household/invitations {role:"owner"}` → 422 code `validation_error` (TS union schema)
  2. admin `PATCH /users/me {avatarColor:13}` → 422 `validation_error` (TS integer range)
  3. admin `GET /activity?limit=500` → 422 `validation_error` (max 100)
- Error twin: all three are error twins
- Normalize: messages compared literally
- Both stacks: yes     Timing: normal     Pass when: status and code match
- Known caveat: Kotlin validates in services rather than schemas, so some of these may be 400 `validation_error`; the status difference is a finding.

### E2E-X-05  An allowed origin gets a CORS preflight answer
- Capability: CORS allow (plan §4.14)     Oracle: TS, SPEC
- Needs: either stack up (each side's own origin)
- Steps:
  1. `OPTIONS /api/v1/auth/setup` with `Origin: <this stack's origin>`, `Access-Control-Request-Method: POST`, `Access-Control-Request-Headers: content-type`
  2. status is 204 (TS oracle) or 200
  3. `Access-Control-Allow-Origin` equals `ctx.side.origin`; `Access-Control-Allow-Credentials`="true"; the allowed methods include POST
- Error twin: X-06
- Normalize: header value case is compared as sent (both send the origin verbatim)
- Both stacks: yes     Timing: normal     Pass when: the preflight advertises the caller's origin and credentials

### E2E-X-06  A denied origin gets no CORS grant
- Capability: CORS deny (plan §4.14, SEC)     Oracle: TS, SEC
- Needs: either stack up
- Steps:
  1. `OPTIONS /api/v1/auth/setup` with `Origin: http://evil.example` and `Access-Control-Request-Method: POST`
  2. status is 204/403
  3. there is **no** `Access-Control-Allow-Origin: http://evil.example` (absent or `null` is acceptable, the evil origin is not)
  4. a real `POST /auth/login/options` with `Origin: http://evil.example` → 403 `csrf_blocked` (AUTH-09 overlap, but checked here for the CORS layer)
- Error twin: step 4
- Normalize: header names case-insensitive
- Both stacks: yes     Timing: normal     Pass when: the denial is unambiguous and no wildcard appears with credentials

### E2E-X-07  A non-JSON content type is refused cleanly
- Capability: Content-type handling (plan §4.14)     Oracle: TS
- Needs: either stack up
- Steps:
  1. `POST /auth/login/options` with `Content-Type: text/plain` and body `{}` → 4xx with an envelope (TS oracle status)
  2. `POST /auth/login/options` with `Content-Type: application/json` and body `not json` → 400 code `bad_request`
  3. no HTML error page and no stack frame in either body
- Error twin: both steps
- Normalize: messages compared literally
- Both stacks: yes     Timing: normal     Pass when: status/code match
- Known caveat: Kotlin maps `BadRequestException` to 422 `validation_error`; a status/code difference is a finding.

### E2E-X-08  A list endpoint paginates with limit/nextCursor
- Capability: Pagination conventions (plan §4.14)     Oracle: TS
- Needs: household world (admin)
- Steps:
  1. `GET /activity?limit=2` as admin → 200 `{items:[…], nextCursor:string|null, newCount:number}`
  2. `items.length <= 2`; every item has a string `id` and numeric `createdAt`
  3. with `limit=100` the answer is still well formed; `nextCursor` is null when the page is not full
  4. arrays are compared in order (newest first per API.md)
- Error twin: `limit=0` and `limit=101` → 422 `validation_error` (X-04 covers 500)
- Normalize: ids, timestamps
- Both stacks: yes     Timing: normal     Pass when: the envelope keys, types and bounds match

### E2E-X-09  JSON responses declare the same content type
- Capability: Response headers (plan §4.14)     Oracle: TS
- Needs: either stack up
- Steps:
  1. `GET /health` → 200, `Content-Type: application/json` (parameters ignored)
  2. `GET /api/v1/auth/setup` → 200, same content type
  3. an error (`GET /api/v1/definitely-not-a-route`) → same content type
- Error twin: step 3
- Normalize: content-type parameters (`charset`) ignored by the transcript comparer
- Both stacks: yes     Timing: normal     Pass when: every JSON response declares JSON
- Known caveat: F-005 (Kotlin omits `Date`) is not asserted here; it is already recorded.

### E2E-X-10  No error leaks an HA or server-internal string
- Capability: Error text hygiene (plan §4.14, SEC)     Oracle: TS, SEC
- Needs: household world
- Steps:
  1. collect the bodies from an unknown route (404), a bad validation (400/422) and an anonymous household read (401)
  2. assert none contains `Service not found`, `Entity not found`, `Unauthorized`, `ECONNREFUSED`, `SQLITE`, ` at ` stack frames, or a cookie/token value
  3. assert every body parses as JSON with only `error.code`/`error.message`/`error.details`
- Error twin: this is the security card (malformed-JSON hygiene is X-07's job)
- Normalize: none
- Both stacks: yes     Timing: normal     Pass when: every error is a clean envelope

### E2E-X-11  BLOCKED — OpenAPI, `TRUST_PROXY`, request-size and log-hygiene checks
- Capability: `/docs`, proxy trust, body limits, structured logs (plan §4.14)     Oracle: SPEC
- Why blocked: (a) Kotlin has no `/docs`/OpenAPI route in the inventory (T1.6 lists it as only-TS); (b) `TRUST_PROXY` needs a request that actually arrives through a proxy, which the harness does not run; (c) neither API.md nor the code documents a request-size limit, so a limit cannot be invented; (d) the log format is not a wire contract and a correlation id is not specified in API.md.
- Suggested follow-up: decide with the user whether these belong in PARITY.md as intended differences; then add cards in the M8/M9 pass.
- Both stacks: yes     Timing: normal     Pass when: the plan decides the contract
