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

## In Progress

- Run migration and test multi-tenancy flow.

## Left

- Frontend Integration (Sites & Employees CRUD) — ensure all fetches scope to current tenant.
- Uploads & File Handling.
- Extraction Worker (OpenCV/OpenAI).
- Review Console.
- CSV Export.
- Heroku Deploy.

## Known Issues

- None.
