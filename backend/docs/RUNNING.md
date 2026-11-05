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

## Keeping Home Assistant in step

Alice checks every 15 minutes that the scripts and automations it created in Home Assistant still match what it wrote, and `POST /admin/config-sync/verify` does it on demand. Anything edited or removed there shows as `drifted` (and admins are notified); `POST /admin/config-sync/resync` restores it.

## What needs the worker

Without it everything in Alice still works, but nothing is written to Home Assistant: scenes and routines are not mirrored as scripts, automations do not exist in Home Assistant, the household-mode helper is not created, and voice exposure is not applied. Each of those shows `not_synced` or `pending` with a reason, and everything catches up when the worker starts (or on `POST /admin/config-sync/resync`).

## Tests

`bun test` runs everything. The tests marked live (`*.live.test.ts`) need the mock Home Assistant:

```bash
bun run ha:up
bun run ha:bootstrap   # writes .env.test with a fresh token
```

After pulling changes to `dev/ha/`, reset it with `bun run ha:down` first.
