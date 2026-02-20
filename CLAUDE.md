# AutomateHQ - Project Context

## Overview
Web application that automates HR processes — primarily work card (timesheet image) processing for staffing/payroll companies. Core use cases: extract structured data from handwritten/scanned work card images using AI vision, manage employees, and export payroll-ready CSVs.

## Architecture

**Monorepo with three services, deployed on Heroku:**

```
frontend/   React 18 + TypeScript + Vite + Tailwind CSS v4
backend/    Flask REST API (Python)
worker/     Background extraction worker (Python)
```

**Database:** PostgreSQL — images stored as BYTEA blobs, no external object storage.

**Queue:** Postgres table-based polling (no Redis/Celery). Worker polls every 5s for `PENDING` jobs.

**External APIs:** OpenAI Vision (gpt-4o-mini) for image extraction, Twilio for WhatsApp messaging.

---

## Service Details

### Frontend (`frontend/`)
- **React 19 + React Router v7 + Tailwind v4 + Recharts**
- Route structure: `/:businessCode/<section>` (multi-tenant via URL)
- Auth: JWT stored in localStorage, Axios interceptor adds `Bearer` header
- `src/api/` — typed Axios clients per domain
- `src/pages/` — 9 full pages; `src/components/` — 19 components
- `src/types/index.ts` — shared TypeScript interfaces (~285 lines)
- `src/context/` — `AuthContext`, `SidebarContext`

### Backend (`backend/app/`)
- **Flask 3 + Flask-SQLAlchemy + Flask-Migrate (Alembic)**
- App factory in `__init__.py`; blueprints registered per domain
- **Layers:** `api/` → `repositories/` → `models/`; `services/` for complex logic
- `repositories/base.py` — generic base repository pattern
- Multi-tenancy: all queries scoped by `business_id` FK
- JWT auth via `auth_utils.py`; `business_context.py` for tenant scoping

**API Blueprints:**
| Route | File | Purpose |
|---|---|---|
| `/api/auth` | `api/auth.py` | Login, current user |
| `/api/businesses` | `api/businesses.py` | Business CRUD |
| `/api/sites` | `api/sites.py` | Site management |
| `/api/employees` | `api/employees.py` | Employee CRUD + bulk import |
| `/api/users` | `api/users.py` | Admin user management |
| `/api/work-cards` | `api/work_cards.py` | Work card lifecycle |
| `/api/dashboard` | `api/dashboard.py` | Metrics/summaries |
| `/api/employee-imports` | `api/employee_imports.py` | Import history |
| `/api/public-portal` | `api/public_portal.py` | Guest upload via token |

### Worker (`worker/`)
- **run.py** — polling loop; picks up `PENDING` extractions, orchestrates pipeline
- **extractor.py** — OpenCV preprocessing + OpenAI Vision API; Pydantic output models; passport normalization; targeted re-reads for low-quality rows
- **matcher.py** — matches extracted employee name/passport to DB (exact → fuzzy → multi-site fallback)
- Max 3 retries per job; 30-min stale lock timeout

---

## Database Schema (Key Tables)

| Table | Purpose |
|---|---|
| `businesses` | Multi-tenancy root |
| `users` | Admin users (email, phone, role, password_hash) |
| `sites` | Work locations (site_name, site_code) |
| `employees` | Worker records (full_name, passport_id, phone) |
| `work_cards` | Uploaded card metadata (month, review_status) |
| `work_card_files` | Image BYTEA blobs |
| `work_card_extraction` | AI extraction results + match status |
| `work_card_day_entries` | Per-day hours with conflict tracking |
| `export_runs` | Payroll export history |
| `audit_events` | Action audit trail |
| `upload_access_requests` | Public portal guest tokens |

---

## Core Workflow
1. **Upload** — Admin uploads work card images (single or batch) by site/month
2. **Extract** — Worker preprocesses image → sends to OpenAI Vision → gets structured JSON (name, passport, daily hours)
3. **Match** — Worker matches extracted identity to employee DB
4. **Review** — Admin reviews/corrects extraction accuracy in UI
5. **Approve** — Admin approves final data
6. **Export** — Generate payroll-ready CSV via `hours_matrix_service.py`

---

## Multi-Tenancy
- Every entity has a `business_id` FK
- Frontend routes include `/:businessCode/` prefix
- `TenantGuard` component validates user-to-business mapping
- All repository queries filter by `business_id`
- Global uniqueness: user email/phone, employee passport_id

---

## Key Files to Know
- `backend/app/__init__.py` — Flask app factory, blueprint registration
- `backend/app/models/work_cards.py` — core work card ORM models
- `backend/app/api/work_cards.py` — work card API (40KB, most complex)
- `backend/app/api/sites.py` — site API (56KB, largest)
- `worker/extractor.py` — AI extraction logic (48KB)
- `worker/run.py` — worker main loop (19KB)
- `frontend/src/types/index.ts` — all shared TS types
- `frontend/src/App.tsx` — route definitions

## Deployment
- **Heroku Procfile:** `web` (gunicorn Flask), `worker` (Python poller), `release` (alembic migrations)
- Flask serves the React build (`frontend/dist/`) as static files in production
- Dev: Vite on port 5173, Flask on 5000, Vite proxies `/api` to backend
- Env vars: `DATABASE_URL`, `SECRET_KEY`, `OPENAI_API_KEY`, `TWILIO_*`, `CORS_ORIGINS`, `JWT_*`

## Testing
- Backend tests in `backend/tests/` — API CRUD, hours matrix, export, query efficiency
- Worker tests in `worker/tests/`
- Run backend tests: `pytest backend/tests/`
