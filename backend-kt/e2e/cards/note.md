# NOTE — activity, notifications, alerts, push

Cards for plan §4.10 (`E2E_PARITY_PLAN.md`). Written before `scenarios/note.ts` (RUNBOOK §6.1).
The seeded template power sensors (`sensor.parity_*_power`) are driven through their `input_number.*`
helpers, so the alert path is real HA data, not a fixture.

## Coverage

| Catalogue bullet (plan §4.10) | Cards |
|---|---|
| Power-limit alert: raise at 90 %, clear below 85 % | NOTE-01, NOTE-02 |
| Notification read / read-all, per person, guests refused | NOTE-01 |
| Alerts list and acknowledge; guests refused | NOTE-02 |
| Push subscription CRUD, 10-device cap, tokens never returned | NOTE-03 |
| Push registration rules (known services, keys, platform) | NOTE-03 |
| Delivery to a harness-owned fake push endpoint (T5.2) | **BLOCKED** — both backends allow-list real push-service hosts; `127.0.0.1:3191` is refused by design, so the fake endpoint cannot be exercised without changing the product's security rule (F-031) |
| Door/window left open for 10 minutes | **BLOCKED** — real 10-minute window; slow tier (M8) |
| Quiet hours, urgent bypass, 410 forgotten, runaway cap | **BLOCKED** — needs the provider unit path / a real push-service response; M8 or a fake-provider mode |
| Activity timeline entries and filtering | M5 follow-up (same alert path; REST shape is covered in NOTE-01/02) |

---

### E2E-NOTE-01  A power-limit crossing creates a notification that can be read
- Capability: `GET /notifications`, read/read-all     Oracle: HA, TS
- Needs: HA-connected household world
- Steps:
  1. find the Thing whose primary is `sensor.parity_kettle_power`; set its `powerLimitW` to 1600
  2. drive `input_number.parity_kettle_power` to 1500 through HA
  3. wait for HA to report the sensor and for a `power_limit` notification to appear
  4. the notification has `kind:"power_limit"`, an unread `readAt:null`, and a title naming the limit
  5. a member has their own copy; a guest gets 403
  6. `POST /notifications/:id/read` clears the unread count; `read-all` marks the rest
  7. drop the reading back to 0 and remove the limit
- Error twin: step 5
- Normalize: ids, timestamps
- Both stacks: yes     Timing: normal     Pass when: the real power reading raises exactly one notification per recipient

### E2E-NOTE-02  An alert is listed, acknowledged, and cleared
- Capability: `GET /alerts`, `POST /alerts/:id/ack`     Oracle: HA, TS
- Needs: HA-connected household world
- Steps:
  1. raise the power alert as in NOTE-01
  2. `GET /alerts` → an entry with `kind:"power_limit"`, the Thing id and `ackedAt:null`
  3. `POST /alerts/:id/ack` → the entry now has `ackedAt` and remains listed
  4. a guest gets 403; dropping the reading below 85 % clears it from the default list
  5. `GET /alerts?includeCleared=true` still shows the cleared entry
- Error twin: step 4
- Normalize: ids, timestamps
- Both stacks: yes     Timing: normal     Pass when: the alert lifecycle is visible and guest access is refused

### E2E-NOTE-03  Push subscriptions register safely and never echo the token
- Capability: `GET/POST/DELETE /users/me/push-subscriptions`     Oracle: TS, SEC
- Needs: HA-connected household world
- Steps:
  1. `GET` → `platforms` includes `webpush`, `vapidPublicKey` is a string, `devices: []`
  2. register a Web Push endpoint on `fcm.googleapis.com` with valid keys → 200
  3. register the same endpoint again with a new label → still one device, label updated
  4. the raw response never contains the token or the key material
  5. an unknown push host, a non-https URL, and an FCM token shorter than the minimum → 400 `validation_error`
  6. a second person cannot delete the first person's device (404); the owner can (200)
- Error twin: step 5
- Normalize: ids
- Both stacks: yes     Timing: normal     Pass when: registration follows the rules and secrets never come back
- Known caveat: no test push is sent in this tier; the fake push endpoint is blocked by the host allow-list (F-031).
