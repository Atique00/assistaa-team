# Assistaa on Supabase — Phase 1 status

Project: **assistaa** · ref `zciuchdximmzwiisdkqu` · region Singapore · Free plan
API: `https://zciuchdximmzwiisdkqu.supabase.co` · publishable key `sb_publishable_WMggW823F5JaQWI5tZUn3A_2RCcqKcA` (safe to be public; RLS protects data) goes into `js/config.js` for the test version

## What is live (9 Nov 2026)
| Piece | State |
|---|---|
| Schema `supabase/migrations/0001_core.sql` | applied — 51 tables in the API schema + 1 private PIN table, RLS on every table |
| PIN helpers `0002_pin_functions` | applied — server-only (`service_role`) |
| Data copied from both Google Sheets | team (9 people), settings, rules, stores, 30 activity events, 26 reports, 8 tasks (+5 owners), 30 support person-days of stats, ticket split |
| PINs | bcrypt hashes in `private.employee_pins`; plain PINs are **not** in Supabase |
| Edge function `auth-pin` | live — `login` and `change` |
| Nightly encrypted backup | `.github/workflows/db-backup.yml` — secrets set, first run green 10 Nov |
| Edge function `team-api` | live — same contract as Apps Script `doPost`; direct Postgres (≈50–90 ms per call warm); reads and writes tested 10 Nov. (`api` = older REST version, unused; `ping` = timing probe) |
| Test app | https://team.assistaa.com/next/ — built by `tools/build-next.sh`, own storage (`assistaa-next.`), TEST label |
| Push from Supabase | waits for secret `FIREBASE_SERVICE_ACCOUNT`; until then saved to `notifications` |

Not copied (on purpose): `owner_pin` (hashed instead), "Issue Seen" (a cache the issue portal rebuilds), empty tabs (Inbox, Fines, Scores, Push Tokens, Client Messages, Tickets Waiting).

## Access rules (tested with real sessions)
- Owner/admin: everything.
- Team member: own reports, activity, stats, fines, scores, inbox, tasks assigned to them; can edit only about/skills/photo/phone on their own profile.
- Signed-out visitors: nothing. PIN functions cannot be called from the browser.
- Login: 15 wrong tries per device or 60 overall per 10 min → 10-minute wait. Every try is logged in `login_attempts`.

## Switched over — 10 Nov 2026, 08:2x Dhaka
team.assistaa.com now runs on Supabase (`team-api`). /next/ redirects to /.
- Re-synced from the sheets right before the switch (2 store end reports, Sarza's reply, support stats 9–10 Nov, Rakibuzzaman's new PIN).
- Scheduled task "3-hourly check + team app update" (trig_012eLyhk7No8vL4uhLzvCE6K) writes support stats, waiting tickets and Claude's report replies to Supabase via `sync_support_stats`, `set_tickets_waiting`, `reply_report` / view `reports_to_answer`; it still mirrors stats/waiting tickets/client messages to the sheets.
- Old task "3-hourly check + sheet update" (trig_01KksMLEKynSmuMjGZjJZgNU) is paused, not deleted.
- Issue portal still runs on the store Apps Script (`issuesUrl` in js/config.js).
- Push notifications from Supabase need secret FIREBASE_SERVICE_ACCOUNT.

## Switch-over plan
1. Test copy of the app on a separate address reading Supabase.
2. One week side by side; daily compare of row counts (reports, activity, stats).
3. Switch only after Atiq approves. Final re-sync of the sheets right before.

## Rollback
Put the two Apps Script URLs (kept as comments in `js/config.js`) back into `backends`, re-enable the old scheduled task and pause the new one. Data entered after the switch lives only in Supabase and would need copying back. Supabase can be restored from the latest encrypted nightly dump:
`gpg -d assistaa-YYYY-MM-DD.dump.gpg > db.dump && pg_restore -d "$DB_URL" --no-owner db.dump`
