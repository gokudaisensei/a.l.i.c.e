# Alice — Features

Alice is a household app for your smart home. It sits on top of Home Assistant, so your existing devices and integrations keep working. Alice adds a simpler interface, safer sharing and more control over who can do what.

## One card per device
- Each physical device shows up once, with a clean name, in the right room. You don't see a pile of technical entities.
- Rename, hide, merge or split devices to match how you think about your home.
- Related settings, such as a camera's privacy shutter or a mic mute, appear on the device they belong to.
- Search by name or nickname, filter by room or type, and pin favorites in your own order.

## Control that confirms itself
- Controls fit the device: color wheel and drag-to-dim for lights, dials for climate and fans, position for blinds and covers.
- Alice checks that the device did what you asked and tells you if it didn't.
- Undo the last change within ten minutes.
- Group devices and control them together, or work room by room.

## Scenes, routines and automations
- **Scenes:** set several devices at once with one tap.
- **Routines:** run steps in order, with delays, and call other scenes or change the household mode.
- **Automations:** build them in plain language. Triggers include arriving, leaving, a set time, sunset, a door opening, motion and a device going over its power limit. Conditions include darkness, who is home, weekdays or weekends, and household mode. Alice shows a plain-English summary and a dry-run preview before saving.
- Everything is created in Home Assistant too, so it keeps running if Alice is offline. Alice checks every 15 minutes that nothing was changed behind its back.

## Household modes
- Switch between Home, Away, Night and Vacation.
- Alice suggests a mode change when it fits, such as "Everyone has left, switch to Away?". It never changes the mode on its own.

## People, access and security
- **Sign in with passkeys.** No passwords to steal or forget. Recovery codes are available if you lose a device.
- **Roles for the household:** admin, member and guest. Guests see only the devices and scenes you allow, and get no activity history.
- **Fresh passkey check for sensitive actions,** such as unlocking a door or saving an automation that unlocks one.
- **Invite family and guests** with a code.
- **Audit trail:** every command is recorded with who sent it and what happened.
- The Home Assistant admin credential is sealed so the main server can't read it. A separate worker process holds the key.
- Time-limited, read-only support access for troubleshooting, controlled by you.

## Notifications and awareness
- **Activity timeline** of what happened in your home: devices, locks, scenes, modes, automations and who arrived or left.
- **Alerts** when a device nears its power limit or a door, window or garage is left open for ten minutes.
- **Push notifications** to your phone and browser.

## Energy and history
- Live power draw, today's usage and the biggest consumers.
- Hourly and daily energy history per device.
- A plain-language comparison with earlier evenings, for example "Used 20% more than usual".
- Set a power limit on any device.
- See how any device's state changed over time.

## Ask Alice
- Type a short request, like "turn off the lights in the kitchen", and Alice proposes what it will do. You confirm before anything runs.
- Alice only suggests actions on devices you're allowed to control.
- Choose which devices are exposed to Home Assistant's voice assistant.

## Backups and administration
- Back up Alice and Home Assistant together, with verification status for each backup.
- A health overview, update information and a sync status for the connection to Home Assistant.

## Works where you are
- Mobile-friendly web app, built to be packaged for iOS and Android.
- Live updates without refreshing.
- Large text sizes, visible alternatives to gestures, light and dark appearance.

## Setup and requirements
- Works with any Home Assistant you can reach by address and access token: Home Assistant OS, Container or Core.
- One-command setup, plus scripts to stop and remove it. Can be put behind a reverse proxy or tunnel for remote access.
- Needs Home Assistant, and a small background worker process to push scenes, routines, automations and backups into it.
