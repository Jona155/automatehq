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
- **Login page design fix**: Login page at `/login` was rendering with broken/unstyled layout. Root cause was default Vite styles in `frontend/src/index.css` (e.g. `body { display: flex; place-items: center; }`, custom button/input rules) overriding Tailwind. Fixed by (1) removing all conflicting Vite defaults from `index.css`, (2) switching to Tailwind v4 syntax (`@import "tailwindcss"` + `@theme` for primary/background/font), (3) keeping minimal `@layer base` for body margin, font-family, box-sizing. Login page now shows correct header, centered card, gradient background, styled inputs, primary button, footer.
- **App shell + navigation**: RTL (`lang="he" dir="rtl"` in `index.html`). Authenticated layout with `Layout` + `Sidebar`; routes `/:businessCode/dashboard|employees|sites|users`. Placeholder pages (Hebrew title + "בקרוב"). Sidebar: Dashboard, Employees, Sites, Administration → Users; active states; logout.
- **Multi-tenancy (Business entity)**: Restored `Business` as first-class entity. All models now have `business_id` FK. Auth validates business exists/active. Frontend uses `business.code` for URL routing with `TenantGuard` to validate URL matches user's tenant.
- **Businesses API**: Implemented full CRUD API for Business entity (`backend/app/api/businesses.py`) with OpenAPI spec (`specs/businesses.yaml`).
- **Users Management page**: Admin page at `/:businessCode/users` — list (table), create (modal: email, full_name, password), edit (email/full_name only), soft-delete with confirmation; backend scopes all user ops to `g.current_user.business_id`; self-delete blocked. API: `frontend/src/api/users.ts`; page: `frontend/src/pages/UsersPage.tsx`.
- **Sites page**: List at `/:businessCode/sites` — table (site name, code, employee count via API `include_counts`, activity status); includes active and inactive; row click → `/:businessCode/sites/:siteId`. Site details page placeholder shows site name only. Available to all authenticated users. API: `frontend/src/api/sites.ts`; pages: `SitesPage.tsx`, `SiteDetailsPage.tsx`.

## In Progress

- None.

## Left

- Business management UI (optional).
- Uploads & File Handling.
- Extraction Worker (OpenCV/OpenAI).
- Review Console.
- CSV Export.
- Heroku Deploy.

## Known Issues

- None.

## Lessons

- **TypeScript type-only imports**: With `verbatimModuleSyntax` (tsconfig), types/interfaces must use `import type { X }` not `import { X }`. Otherwise build fails (TS1484) and browser can show "module does not provide an export named 'X'". When importing both values and types from the same module, use two lines: `import { fn } from './api';` and `import type { SomeType } from './api';`.
- **API multi-tenancy**: All domain APIs (sites, employees, users) must scope by `g.current_user.business_id`. Create must set `data['business_id']`; list/get/update/delete must filter or verify `resource.business_id`. Uniqueness checks are per tenant. See [memory-bank/api-tenant-audit.md](memory-bank/api-tenant-audit.md) and system-patterns.md (API Multi-Tenancy).
