# Active Context

## Current Focus

Scaffold complete. Next: DB migrations.

## Next Steps

1. DB migrations (sites, employees, admins, work_cards, extractions, extraction_jobs).
2. Auth (admin login, protect API + UI).
3. Sites + employees CRUD, then uploads, extraction worker, review, CSV export.
4. Heroku deploy.

## Decisions

- Memory Bank: lowercase-hyphen filenames; concise only.
- Job queue: Postgres table + Python polling worker (no Redis/Celery/pg-boss).
- Matching: passport exact → assign; otherwise unassigned.
