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

## API Multi-Tenancy (Mandatory)

All domain APIs (sites, employees, users, etc.) are **tenant-scoped**. Every request runs in the context of the authenticated user’s business (`g.current_user.business_id`). APIs **must** enforce this; otherwise you get 500s (e.g. NOT NULL `business_id`) or cross-tenant data leaks.

**Rules for every tenant-scoped API:**

1. **List (GET collection)**  
   Always filter by `business_id`: pass `filters={'business_id': g.current_user.business_id}` to repo, or use repo methods that accept `business_id` and filter by it.

2. **Create (POST)**  
   Set `data['business_id'] = g.current_user.business_id` before calling `repo.create(**data)`. Never trust `business_id` from the client.

3. **Get one / Update / Delete (GET/PUT/DELETE by ID)**  
   After `repo.get_by_id(id)`, check `resource.business_id == g.current_user.business_id`. If not, return 404. On update, `data.pop('business_id', None)` so clients cannot change tenant.

4. **Uniqueness checks**  
   Scope to tenant: e.g. “site name unique” means unique per business, not globally. Use repo methods like `get_by_name_and_business(name, business_id)`.

5. **Repository layer**  
   List/count methods that support tenant scoping should accept an optional `business_id` (or equivalent filter) and apply it in the query.

**Reference implementations:** `backend/app/api/users.py`, `backend/app/api/employees.py`, `backend/app/api/sites.py` (after fix).

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
