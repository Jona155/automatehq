# Active Context

## Current Focus

Multi-tenancy architecture implemented. Business entity restored as first-class citizen. Login validates business exists/active, returns business context. Frontend routes use `/:businessCode/...` with TenantGuard validation.

## Next Steps

1. Run migration (`flask db upgrade`) to apply Business entity changes.
2. Seed default business and admin user.
3. Integrate API with Frontend (Sites + Employees CRUD) — ensure all data is scoped to current tenant.
4. Uploads, extraction worker, review, CSV export.
5. Heroku deploy.

## Decisions

- Memory Bank: lowercase-hyphen filenames; concise only.
- Job queue: Postgres table + Python polling worker (no Redis/Celery/pg-boss).
- Matching: passport exact → assign; otherwise unassigned.
- DB Schema: Initialized with Flask-SQLAlchemy + Alembic.
- Image Storage: BYTEA in Postgres (`work_card_files`).
- Backend Structure: Reorganized into `backend/app/` package with factory pattern.
- API Structure: Flask Blueprints per domain (`sites`, `employees`, `users`, `work_cards`), using Repository pattern.
- Testing: `unittest` with real DB connection (dev env) for CRUD verification.
- API Specs: OpenAPI 3.1 YAML files in `specs/`; must be kept in sync with code changes.
- **Multi-tenancy**: Business entity with `id`, `name`, `code` (URL slug), `is_active`. All domain models have `business_id` FK. Auth enforces business validation. Frontend uses `business.code` for routing; `TenantGuard` validates URL matches user's tenant.
