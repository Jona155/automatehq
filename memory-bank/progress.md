# Progress

## Done

- Memory Bank (lowercase-hyphen, concise).
- Revised plan (no pg-boss; Python polling worker; MVP-simple).
- Monorepo scaffold: `frontend/` (React+Vite), `backend/` (Flask), `worker/` (stub).
- README, `.env.example`, `.gitignore`.
- DB Schema & Migrations (Tables: users, sites, employees, work_cards, work_card_files, work_card_extraction, work_card_day_entries, export_runs, audit_events).
- Repository Layer (Data Access Layer for all models).
- API Layer (Endpoints for Sites, Employees, Users, WorkCards).
- API Testing (CRUD verification with `backend/tests/test_api_crud.py`).
- **Bugfix: Site employees failing to load (500)**: Fixed `GET /api/employees?site_id=...` by parsing `site_id` to UUID and returning 400 on invalid UUID (`backend/app/api/employees.py`). Added traceback logging in `backend/app/api/sites.py` to make future 500s diagnosable.
- **Login page design fix**: Login page at `/login` was rendering with broken/unstyled layout. Root cause was default Vite styles in `frontend/src/index.css` (e.g. `body { display: flex; place-items: center; }`, custom button/input rules) overriding Tailwind. Fixed by (1) removing all conflicting Vite defaults from `index.css`, (2) switching to Tailwind v4 syntax (`@import "tailwindcss"` + `@theme` for primary/background/font), (3) keeping minimal `@layer base` for body margin, font-family, box-sizing. Login page now shows correct header, centered card, gradient background, styled inputs, primary button, footer.
- **App shell + navigation**: RTL (`lang="he" dir="rtl"` in `index.html`). Authenticated layout with `Layout` + `Sidebar`; routes `/:businessCode/dashboard|employees|sites|users`. Placeholder pages (Hebrew title + "בקרוב"). Sidebar: Dashboard, Employees, Sites, Administration → Users; active states; logout.
- **Multi-tenancy (Business entity)**: Restored `Business` as first-class entity. All models now have `business_id` FK. Auth validates business exists/active. Frontend uses `business.code` for URL routing with `TenantGuard` to validate URL matches user's tenant.
- **Businesses API**: Implemented full CRUD API for Business entity (`backend/app/api/businesses.py`) with OpenAPI spec (`specs/businesses.yaml`).
- **Users Management page**: Admin page at `/:businessCode/users` — list (table), create (modal: email, full_name, password), edit (email/full_name only), soft-delete with confirmation; backend scopes all user ops to `g.current_user.business_id`; self-delete blocked. API: `frontend/src/api/users.ts`; page: `frontend/src/pages/UsersPage.tsx`.
- **Sites page**: List at `/:businessCode/sites` — table (site name, code, employee count via API `include_counts`, activity status); includes active and inactive; row click → `/:businessCode/sites/:siteId`. Site details page placeholder shows site name only. Available to all authenticated users. API: `frontend/src/api/sites.ts`; pages: `SitesPage.tsx`, `SiteDetailsPage.tsx`.
- **Site Details Backend APIs**: Six new endpoints for work card processing: (1) Single/batch upload endpoints create work_card + file + extraction job; (2) File retrieval returns image bytes; (3) Day entries GET/PUT with HH:MM validation; (4) Employee upload status by site+month (NO_UPLOAD|PENDING|EXTRACTED|APPROVED|FAILED); (5) Hours matrix optimized with window functions for 50+ employees, returns 31-day grid; (6) OpenAPI specs updated (`work_cards.yaml`, `sites.yaml`). All enforce multi-tenancy.
- **Site Details Frontend - Tab 1 (Employees & Uploads)**: Employee list with upload status badges; single upload per employee; bulk upload for unknown employees; unknown uploads section with inline employee assignment; month picker persists in localStorage.
- **Site Details Frontend - Tab 2 (Review & Approval)**: Split-screen panel with left sidebar (search, status filters, card list) and right panel (zoomable/rotatable image viewer + 31-day editable grid for HH:MM entries with validation + auto-calculated totals); prev/next navigation; save draft + approve actions.
- **Site Details Frontend - Tab 3 (Hours Matrix)**: 31 days × N employees grid with sticky headers/column; toggles for approved-only and include-inactive; color-coded cells (empty/extracted/approved); optimized for 50+ employees.
- **Site Details page refactor**: Split `SiteDetailsPage.tsx` into tab components — `EmployeesTab` (list + uploads + unknown), `ReviewTab` (cards + image + day entries), `MatrixTab` (grid); shared `SummaryStats`, `UnknownUploadCard`. Fixed `SummaryStatsData` import with `import type`.
- **Apply `g` consistently**: All protected APIs now use `g.business_id` for tenant scoping (standardized in `sites.py`, already used in `employees.py`, `users.py`, `work_cards.py`). `token_required` sets `g.current_user` and `g.business_id`; use `g.business_id` for tenant, `g.current_user` only when handler needs the user object (audit fields, self-checks). Businesses API is admin-level exception (not tenant-scoped). Request-context rule and businesses exception documented in `system-patterns.md` and `api-tenant-audit.md`. `token_required` now also verifies business is active (403 if deactivated after login).
- **Fix intermittent 500s on employees/sites/auth**: Backend exception logging added in `sites.py`, `employees.py`, `auth.py` (all 500 handlers now log with `logger.exception()` + `traceback.print_exc()` for diagnosability). Frontend: `EmployeesPage`, `SitesPage`, `SiteDetailsPage` now guard data fetches on `isAuthenticated` (and `siteId` for details) — prevents calling APIs before auth is ready (e.g., on refresh or navigation).

## In Progress

- None.

## Left

- Business management UI (optional).
- Extraction Worker (OpenCV/OpenAI).
- CSV Export.
- Heroku Deploy.

## Known Issues

- None.

## Lessons

- **TypeScript type-only imports**: With `verbatimModuleSyntax` (tsconfig), types/interfaces must use `import type { X }` not `import { X }`. Otherwise build fails (TS1484) and browser can show "module does not provide an export named 'X'". When importing both values and types from the same module, use two lines: `import { fn } from './api';` and `import type { SomeType } from './api';`.
- **API multi-tenancy**: All domain APIs (sites, employees, users) must scope by `g.current_user.business_id`. Create must set `data['business_id']`; list/get/update/delete must filter or verify `resource.business_id`. Uniqueness checks are per tenant. See [memory-bank/api-tenant-audit.md](memory-bank/api-tenant-audit.md) and system-patterns.md (API Multi-Tenancy).
- **API query param types (UUIDs)**: Never pass raw query-string IDs into repo/db filters. Parse/validate to `uuid.UUID` at the API boundary; return **400** for invalid UUIDs (prevents opaque 500s like the site employees load failure).
