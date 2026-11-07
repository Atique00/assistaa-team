# Assistaa Team

The Assistaa team app (team.assistaa.com): workday start/end, tasks, messages with Atiq, profiles and phone notifications.

- `index.html`, `css/`, `js/`: the app (no build step)
- `firebase-messaging-sw.js`: notifications + offline support
- `backend/api.gs`: the connector added at the end of each team sheet's Apps Script

No passwords or private keys are stored in this repository; team data stays in the Google Sheets.
