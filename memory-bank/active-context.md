# Active Context

## Current Focus

Sites page done (list with employee counts, clickable rows → site details placeholder). Users and Employees pages done. Next: optional Business UI or uploads/extraction.

## Next Steps

1. Implement Business management UI (optional for MVP).
2. Uploads, extraction worker, review, CSV export.
3. Heroku deploy.

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
