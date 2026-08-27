# API rate-limit audit

Audited 2026-08-27. Authenticated identifiers are the resolved Supabase user ID plus the listed scope. They never use a browser-supplied user or connection ID. `demoLogin` uses Vercel's platform-generated `x-vercel-forwarded-for` only when `VERCEL=1`; non-Vercel development uses the shared `local` bucket. Device ingestion uses the authenticated meter-device ID.

| Route | Method | Authentication | Policy | Identifier/scope | Limit (minute/day) | Intentional exemption |
| --- | --- | --- | --- | --- | --- | --- |
| `/api/account/delete` | POST | Supabase user | default | user:`account-delete` | 60/1000 | — |
| `/api/activities` | GET | connected user + Activities feature | default | user:`activities-read` | 60/1000 | — |
| `/api/activities` | POST | connected user + Activities feature | default | user:`activities-write` | 60/1000 | — |
| `/api/activities/[id]` | PATCH, DELETE | connected user + Activities feature + RLS ownership | default | user:`activities-write` | 60/1000 | — |
| `/api/activity-export` | GET | connected user + Activities feature | export | user:`activity-export` | 10/100 | — |
| `/api/activity-report` | GET | connected user + Activities feature | default | user:`activity-report` | 60/1000 | — |
| `/api/admin/diagnostics` | GET | admin user | default | user:`admin-diagnostics` | 60/1000 | — |
| `/api/admin/features` | GET | admin user | default | user:`admin-features` | 60/1000 | — |
| `/api/admin/features/[featureKey]` | PATCH | admin user | default | user:`admin-feature-write` | 60/1000 | — |
| `/api/admin/features/[featureKey]/users` | GET | admin user | default | user:`admin-feature-users` | 60/1000 | — |
| `/api/admin/users` | GET | admin user | default | user:`admin-users` | 60/1000 | — |
| `/api/admin/users/[userId]/permissions` | PATCH | admin user | default | user:`admin-user-permissions` | 60/1000 | — |
| `/api/admin/users/[userId]/role` | PATCH | admin user | default | user:`admin-user-role` | 60/1000 | — |
| `/api/alerts` | GET | Supabase user + Alerts feature | default | user:`alerts-read` | 60/1000 | — |
| `/api/alerts/[type]` | POST | Supabase user + Alerts feature | default | user:`alerts-write` | 60/1000 | — |
| `/api/assistant` | POST | connected user + AI feature | assistant | user:`assistant` | 5/30 | — |
| `/api/assistant/actions` | POST | connected user + AI/action feature checks | assistantAction | user:`assistantAction` | 10/50 | A confirmed sync action additionally consumes `sync` (3/20). |
| `/api/beacon/summary` | GET | timing-safe bearer service token; user fixed by env | exempt | — | — | Private server-to-server integration; secret auth, fixed identity and fixed response shape. |
| `/api/cron/auto-sync` | POST | `CRON_SECRET` bearer | exempt | — | — | Trusted scheduled job; bounded claim batch (10), concurrency (4), and per-connection scheduling/claims. |
| `/api/cron/livemopay-canary` | POST | `CRON_SECRET` bearer | exempt | — | — | Trusted daily diagnostic job with one canary execution. |
| `/api/cron/stale-check` | GET | `CRON_SECRET` bearer | exempt | — | — | Trusted scheduled job; notification dedup is persistent per connection/rule. |
| `/api/daily-rollups` | GET | connected user | default | user:`daily-rollups` | 60/1000 | — |
| `/api/day-intervals` | GET | connected user | default | user:`day-intervals` | 60/1000 | — |
| `/api/demo-login` | POST | public demo token, then fixed configured demo identity | demoLogin | trusted Vercel IP:`demo-login` | 5/30 | — |
| `/api/energy-rows` | GET | connected user | default | user:`energy-rows` | 60/1000 | — |
| `/api/export` | GET | connected user | export | user:`export` | 10/100 | — |
| `/api/live/overview` | GET | Supabase user + Live feature | live | user:`live` | 30/30000 | — |
| `/api/live/pulses` | POST | bearer meter-device API key + Live feature | meter | device:`meter` | 60/30000 | — |
| `/api/livemopay/auto-sync` | POST | Supabase user | external | user:`auto-sync` | 10/100 | — |
| `/api/livemopay/connect` | POST | Supabase user | external | user:`livemopay-connect` | 10/100 | — |
| `/api/livemopay/connection` | GET | Supabase user | default | user:`connection-read` | 60/1000 | — |
| `/api/livemopay/disconnect` | POST | Supabase user | external | user:`disconnect` | 10/100 | — |
| `/api/livemopay/select-account` | POST | Supabase user | external | user:`select-account` | 10/100 | — |
| `/api/notifications` | GET | Supabase user | default | user:`notifications-read` | 60/1000 | — |
| `/api/notifications/[id]/read` | POST | Supabase user + server-resolved ownership | default | user:`notifications-write` | 60/1000 | — |
| `/api/notifications/read-all` | POST | Supabase user | default | user:`notifications-write` | 60/1000 | — |
| `/api/notifications/unread-count` | GET | Supabase user | default | user:`notifications-count` | 60/1000 | — |
| `/api/push/subscribe` | POST | Supabase user | default | user:`push-write` | 60/1000 | — |
| `/api/push/unsubscribe` | POST | Supabase user | default | user:`push-write` | 60/1000 | — |
| `/api/sync` | POST | connected user | sync | user:`sync` | 3/20 | — |

## Non-API application routes

| Route | Method | Authentication | Rate-limit decision |
| --- | --- | --- | --- |
| `/auth/callback` | GET | Supabase OAuth PKCE code exchange | Exempt: one provider redirect, protected by the single-use PKCE code/verifier. The local `next` redirect is constrained to a same-origin path. |
| `/auth/sign-out` | POST | Supabase cookie session | Exempt: cheap idempotent local session revocation; no external workload controlled by request parameters. |

No Next.js Server Actions (`"use server"`) or other application RPC-style HTTP handlers exist outside these route files. Database RPCs are invoked only behind the authenticated/server-side paths documented above.
