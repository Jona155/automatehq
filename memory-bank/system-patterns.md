# System Patterns

## Layout

```
AutomateHQ/
├── frontend/     # React + Vite
├── backend/      # Flask REST API
├── worker/       # Extraction worker (Heroku worker dyno)
└── memory-bank/
```

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
