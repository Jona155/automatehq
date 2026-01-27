# Active Context

## Current Focus

API layer implemented and tested. Next: Authentication implementation.

## Next Steps

1. Auth (user login, JWT, protect API + UI).
2. Integrate API with Frontend (Sites + Employees CRUD).
3. Uploads, extraction worker, review, CSV export.
4. Heroku deploy.

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
