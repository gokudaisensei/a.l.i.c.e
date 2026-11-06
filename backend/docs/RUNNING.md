# Running the backend

Two processes share one SQLite file (`DATABASE_URL`) on the same machine.

| Process | Command | Holds |
|---|---|---|
| Server | `bun run start` (or `bun run dev`) | The operational Home Assistant token (encrypted with `SECRETS_KEY`), the **public** half of the admin-token seal |
| Config-worker | `bun run worker` | The **private** half of the admin-token seal, and with it the only ability to read the Home Assistant admin token |

## First-time setup

1. Generate keys: `bun run keys:generate`. It prints `SECRETS_KEY`, `ADMIN_SEAL_PUBLIC_KEY` and `ADMIN_SEAL_PRIVATE_KEY`.
2. Put `SECRETS_KEY` and `ADMIN_SEAL_PUBLIC_KEY` in the **server's** environment (see `.env.example`).
3. Put `ADMIN_SEAL_PRIVATE_KEY` (and the same `DATABASE_URL`) in the **worker's** environment only. Do not give the server the private key: that is the point of the split.
4. Start the server, sign up the first user (the household admin), then in the app connect Home Assistant (`PUT /ha/connection`) and add an admin token (`PUT /ha/connection/admin-token`; a long-lived token of a Home Assistant administrator).
5. Start the worker. `GET /admin/config-sync` shows `canApply: true` once the worker has checked in.

## Push notifications (optional)

Notifications always appear in the app. To also reach phones and browsers, set up either or both channels in the **server's** environment:

- **Web Push** (browsers, installed web apps): `bun run keys:generate` prints `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY`; set them, plus `VAPID_SUBJECT=mailto:you@example.com`. The app asks `GET /users/me/push-subscriptions` for the public key, subscribes through the browser, and registers the result.
- **Firebase** (Android and iOS apps): create a Firebase project, download a service account key, and set `FCM_SERVICE_ACCOUNT` to the base64 of that JSON file (`base64 -w0 key.json`). The app registers its Firebase token.

People control it themselves with their notification preferences (`pushEnabled`, quiet hours); urgent notifications ignore quiet hours but not an explicit "off".

## Backups

Alice backs up its own database nightly (default 02:30 in the household's time zone, keeping 14) into `backups/` next to the database, or `BACKUP_DIR`, and asks Home Assistant to make its own backup on the Home Assistant host. Set `BACKUP_ENCRYPTION_KEY` (from `bun run keys:generate`) to encrypt Alice's backups, and keep that key somewhere safe. Admins change the schedule, a NAS folder and retention under `/backups/settings`, run a test restore with `POST /backups/:id/verify`, and see backup status in `/admin/health`. To restore Alice's own database, `POST /backups/:id/restore`, then restart the server; the old database stays next to the new one as `.before-restore-<time>`.

## Updates

Alice never replaces its own code. Set `UPDATE_MANIFEST_URL` to a JSON file and Alice tells admins when a newer version exists. Sign it: `bun run keys:generate` prints `UPDATE_SIGNING_PUBLIC_KEY` (server) and `UPDATE_SIGNING_PRIVATE_KEY` (publisher only); write `{"version","notes","publishedAt","artifactSha256"}` and run `UPDATE_SIGNING_PRIVATE_KEY=... bun scripts/sign-manifest.ts manifest.json`. With the public key set, unsigned manifests are ignored; without it they cannot be installed unless `UPDATE_ALLOW_UNSIGNED=true`. Installing (scheduled into the 02:00-04:00 window, or automatic when switched on, or an emergency deploy) takes safety backups (Alice's, and Home Assistant's when possible) and writes `update-requested.json` (`kind`, `version`, `artifactSha256`) next to the database; a supervisor you run (systemd unit, deploy script) must verify the artifact against that checksum, install it and restart the server as the new version (for `kind: rollback`, the old one), which is what marks the update done. If it has not come back after 30 minutes the update is marked failed.

## Support staff

On the server: `bun scripts/operator.ts create ops-114` prints a token once (valid 90 days; add a number of days to change that); give it to that person. They call `/api/v1/operator/homes` with `Authorization: Bearer <token>` and see only homes whose admin has granted access, for as long as the grant lasts. `bun scripts/operator.ts revoke ops-114` locks them out.

## Ask Alice and a model (optional)

Set `AI_API_KEY` (and optionally `AI_MODEL`) and Ask Alice will ask Claude when its own rules find nothing. It sends the typed sentence and device, room, scene and mode names to Anthropic, nothing else, and only proposes: every suggestion is checked and the person still has to pick it. Leave it empty to keep everything local.

## Keeping Home Assistant in step

Alice checks every 15 minutes that the scripts and automations it created in Home Assistant still match what it wrote, and `POST /admin/config-sync/verify` does it on demand. Anything edited or removed there shows as `drifted` (and admins are notified); `POST /admin/config-sync/resync` restores it.

## What needs the worker

Without it everything in Alice still works, but nothing is written to Home Assistant: scenes and routines are not mirrored as scripts, automations do not exist in Home Assistant, the household-mode helper is not created, and voice exposure is not applied. Each of those shows `not_synced` or `pending` with a reason, and everything catches up when the worker starts (or on `POST /admin/config-sync/resync`).

## Running the whole thing

Backend (`backend/`), each in its own terminal: `bun run ha:up`, `bun run ha:bootstrap`, `bun run ha:seed` (once), then `bun run dev` and `bun run worker`. Put keys in `backend/.env` (`bun run keys:generate`; the worker also needs `ADMIN_SEAL_PRIVATE_KEY`). Frontend (`frontend/`): set `BACKEND_URL` and `NEXT_PUBLIC_WS_URL` in `.env.local`, then `bun run dev`. The backend's `WEBAUTHN_ORIGIN` must be the address you open the frontend at (for example `http://localhost:3001`), and the backend must not use the frontend's port.

## End-to-end tests

`cd frontend && bun run e2e` (needs Google Chrome and the seeded mock Home Assistant). See L96 in LIMITATIONS.md.

## Tests

`bun test` runs everything. The tests marked live (`*.live.test.ts`) need the mock Home Assistant:

```bash
bun run ha:up
bun run ha:bootstrap   # writes .env.test with a fresh token
```

After pulling changes to `dev/ha/`, reset it with `bun run ha:down` first.
