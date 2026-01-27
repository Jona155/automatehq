# System Patterns

## Layout

```
AutomateHQ/
├── frontend/     # React + Vite
├── backend/      # Flask REST API
├── worker/       # Extraction worker (Heroku worker dyno)
├── specs/        # OpenAPI 3.1 YAML Specifications
└── memory-bank/
```

## API Documentation

- **Specs**: OpenAPI 3.1 YAML files in `specs/` folder.
- **Workflow**:
  - **Always update** the corresponding YAML spec in `specs/` when changing API endpoints or models.
  - **Review** the API specs when designing new features to ensure consistency.

## Repository Pattern

- **Layered Architecture:** APIs must NEVER access the database directly. All database interactions go through repositories in `backend/app/repositories/`.
- **Base Repository:** All repositories inherit from `BaseRepository[T]` providing standard CRUD and pagination.
- **Dependency Injection:** Repositories use `db.session` from `backend/app/extensions.py`.
- **Eager Loading:** Domain repositories provide specific methods (e.g., `get_with_all_relations`) to prevent N+1 queries.

## Job Queue

- `extraction_jobs` table: `pending` | `processing` | `completed` | `failed`.
- Worker: Python loop, poll Postgres for `pending`, process one, update job + `extractions` + `work_cards`.
- Enqueue on upload; retry = insert new job.

## Matching

- Passport exact match → set `work_cards.employee_id`.
- No match → `needs_assignment`; admin assigns in review.

## Review Status

`extracted` → `needs_assignment` → `needs_review` → `approved` | `failed`.

## Phase 2 Ready

`work_cards.uploader_type`, `uploader_identity`; no extra tables.
