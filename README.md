# Khali Spot

Parking, simplified. For malls, offices, and any other parking location. React + TypeScript + Vite frontend, Supabase Auth/Postgres/Realtime backend, ready for Cloudflare Pages static hosting.

## What works

- Owner and visitor signup/login, persistent Supabase sessions, email confirmation.
- Owners create only their own lots: name, address, description, 1-26 rows and 1-20 spaces per row. Preview before saving a draft, then publish/unpublish. `2 x 5` produces A1-A5 and B1-B5.
- Owners edit lot details and manually mark free, occupied, or unknown from a popup beside the selected slot. It flips sides near screen edges, or fits below on narrow screens; close with Escape, the close button, or a click outside. Layouts are immutable after saving, preserving UUID slot identities for future sensors.
- **Mark all free** lets an owner confirm that all manual-input spaces in the current lot are empty. A single atomic database update persists the marks and notifies visitors. Sensor-input spaces and other lots are unchanged; new lots still start unknown.
- Visitors see published lots and read-only live maps/counts. Pay & Park is an informational **Coming soon** tab: no payments, reservations, or payment collection.
- Unknown is never counted as free. Disconnected/error views retain clearly labelled last-known data. Manual writes are disabled while the view is stale.
- No fake backend fallback or seeded production lots. The login-page map is explicitly illustrative.

## 1. Configure Supabase (required before real account/parking use)

The local `.env.local` contains the supplied **browser-safe publishable key**. It is ignored by Git. `.env.example` contains placeholders. Neither file should ever contain a service-role key or database password. Vite embeds `VITE_*` values into the public browser bundle.

1. Open your Supabase project dashboard **SQL Editor**. Run `supabase/migrations/001_parking.sql`, then `supabase/migrations/002_mark_all_free.sql`, each **once**, as the dashboard's postgres role. If you already applied 001, run **only 002** to add bulk marking; it preserves existing lots and slots. The migrations create schema, immutable role profiles, RLS, explicit grants, owner-only mutation RPCs, and Realtime publication. Automatic RLS can remain enabled; automatic table grants can remain disabled. If a table already exists, stop and reconcile it rather than dropping existing data.
2. In **Authentication > Providers > Email**, enable email/password signup. Keep email confirmation enabled for deployment. Set password length to at least 8. If you temporarily disable email confirmation for a demo, restore it before public use.
3. In **Authentication > URL Configuration**, set the Site URL to the eventual HTTPS Pages URL. Add exact redirect URLs for that site and your local preview (`http://127.0.0.1:5173`, or the actual chosen port). Signup confirmation redirects to the originating app.
4. Confirm `public.parking_revision` appears in the `supabase_realtime` publication (Database > Publications in dashboards that expose it).
5. Create fresh accounts through the app: one **Lot owner**, one **Visitor**, ideally in separate browser profiles. Confirm their emails. The role is selected once at signup and stored in a server-created profile; changing mutable Auth user metadata never changes authorization. Existing Auth accounts at migration time become visitors. No browser role promotion is allowed.

**Backend status:** This repository does not have Supabase management credentials. The publishable key cannot execute SQL or configure Auth. Local tests can verify the app and run the migration in an embedded PostgreSQL engine, but do **not** establish that the hosted Supabase project has been configured or that production Auth/Realtime work. Follow the dashboard steps above and the real-service acceptance checklist below.

## 2. Run locally

```text
npm ci
npm run dev
```

Open the URL printed by Vite (normally `http://127.0.0.1:5173`). The auth page works before the database setup; authenticated parking will explicitly report missing schema or permission failures until the migration is applied.

```text
npm test
npm run build
npx playwright install chromium
npm run test:browser
```

Browser tests use **intercepted test-only Supabase HTTP/WebSocket responses**, not real credentials. Unit/component tests use an injected test API; it is not imported into the production app. Database tests use PGlite PostgreSQL with a local mock `auth.uid()` and local Auth users, exercising actual grants/RLS/RPCs. Hosted Supabase behavior still needs acceptance testing.

## 3. Deploy using free hosting

Use **Cloudflare Pages free plan** and **Supabase free plan** within their current usage quotas. No paid service, payment provider, sensor service, or server runtime is required. Free-tier limits and project inactivity policies can change; verify current quotas in the provider dashboards.

The source repository is `https://github.com/Ankur-Powar-1/khali-spot`. Connect Cloudflare to the personal GitHub account that owns it. **Do not publish with an unrelated work account or change global GitHub authentication.**

With the source committed to that repository (excluding ignored environment files):

1. In Cloudflare **Workers & Pages > Create > Pages > Connect to Git**, select the personal repository and production branch.
2. Framework preset: **Vite**. Build command: `npm run build`. Output directory: `dist`. Use Node.js 22 or newer.
3. Add build environment variables `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` with your Supabase URL and browser-safe key. Never use a service-role key. Set them for every Pages environment you intend to use.
4. Deploy and update Supabase Site URL/allowed redirects to the exact Pages HTTPS URL. Rebuild after environment-variable changes.

Alternative: Cloudflare Pages dashboard **Direct Upload** of the contents of `dist` after a locally configured build, without GitHub authentication. Git-integrated and Direct Upload projects have different deployment workflows; choose before creating the Pages project. A direct-upload build embeds your publishable values, not secrets.

## Data and access design

| Table | Read access | Browser writes |
| --- | --- | --- |
| `profiles` | Own profile only | None; server signup trigger creates role |
| `parking_lots` | Authenticated: published lots or own drafts | Owner-checking RPCs only |
| `parking_slots` | Slots of readable lots | Owner-checking manual RPC only |
| `parking_revision` | Authenticated metadata-only counter | None |

Anonymous access is revoked. Authenticated clients have SELECT grants, no direct INSERT/UPDATE/DELETE grants. `SECURITY DEFINER` mutation functions pin an empty search path and validate `auth.uid()` against immutable owner profiles and lot ownership. Snapshot is `SECURITY INVOKER` and reads lots and slots in one MVCC statement under RLS. No client-supplied owner ID is trusted.

Every write bumps a metadata-only revision in the same transaction. Realtime invalidates the browser snapshot, which is then re-read through RLS. This deliberately handles **unpublish**: a visitor cannot subscribe reliably to an update whose new lot row is no longer readable. The revision reveals no draft name, address, owner, or slot data. A burst of events coalesces; events arriving during a fetch cause another fetch. There is also a 30-second reconciliation poll and reconnect/tab-visibility refresh. Counters and maps are last-known unless both Realtime and a successful snapshot are available; failures and disconnects are surfaced.

`parking_slots.id` is a stable UUID. `input_mode`, `input_source`, `observed_at`, and `updated_at` are future sensor boundaries. All app-created slots use `manual` / `manual_demo`, initially `unknown` with no observation. Manual observations do not age into fake "unknown" just because a car may have moved; they remain last marked values and are not a guarantee. Future sensor mode must reset occupancy to unknown until a valid sensor observation arrives and enforce sensor freshness server-side. **No sensor writer, enrollment, firmware, mode-switch UI, or ingestion endpoint is built now.** Browser manual RPCs reject sensor-mode slots, preventing competition. Authorised backend migration will be needed before sensor mode is enabled.

Owners here are self-selected demo roles, not administrators and not verified property owners. Each can create/manage only their own lots, whether at a mall, office, or another location. Property ownership verification, password reset UX, deletions, bookings and payments are outside this demo.

## Real-service acceptance checklist (after dashboard setup)

1. Owner signup + email confirmation + login succeed. Create a 2x5 draft; refresh; all 10 stable labels and IDs remain.
2. Visitor signup/login in another browser: draft is invisible. Publishing makes it appear without manual refresh.
3. Owner marks A1 free/occupied/unknown; visitor map/counts follow automatically. Both refresh without losing state.
4. Unpublish removes the lot from the visitor's map without manual refresh.
5. A second owner cannot edit the first owner's lot; visitor write RPCs and direct table writes fail.
6. Disconnect network: warning appears, old counts are clearly last-known, owner slot writes are disabled. Reconnect: successful sync clears the warning.
7. Pay & Park collects nothing and changes no parking state. Check phone and laptop layouts.

For bulk marking, confirm **Mark all free** in an owner window; verify all manual-input spaces become free and the visitor map/counts update without refresh. Cancel must change nothing. Visitors and other owners cannot call the bulk RPC, and sensor-input spaces stay unchanged.

Optional dashboard regression check: run `supabase/tests/access.sql` as postgres **after both migrations**. It creates temporary test users/lots inside a transaction, switches JWT claims/roles, asserts boundaries, then rolls everything back. Do not run pieces independently or commit the transaction. These tests are also executed locally against PostgreSQL by `npm test`.
