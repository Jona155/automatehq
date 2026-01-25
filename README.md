# AutomateHQ Admin Portal

Work cards → extraction → review → CSV. Admin-only payroll processing from employee work card images.

## Stack

- **Frontend:** React 18 + Vite (`/frontend`)
- **Backend:** Flask REST API (`/backend`)
- **Worker:** Python polling worker for extraction (`/worker`)
- **DB:** PostgreSQL (images as blobs)
- **Queue:** Postgres table + worker poll (no Redis/Celery)

## Setup

1. **Env:** Copy `.env.example` → `.env`, set `DATABASE_URL`, `SECRET_KEY`, `OPENAI_API_KEY`.
2. **DB:** Create Postgres DB, run migrations (TBD).
3. **Backend:** `cd backend && pip install -r requirements.txt && python app.py`
4. **Frontend:** `cd frontend && npm install && npm run dev`
5. **Worker:** `cd worker && pip install -r requirements.txt && python run.py` (after migrations + job table)

## Run

Use separate terminals:

**Backend**
```bash
cd backend
python app.py
```
→ http://localhost:5000

**Frontend**
```bash
cd frontend
npm run dev
```
→ http://localhost:5173 (proxies `/api` to backend)

**Worker** (after DB + migrations)
```bash
cd worker
python run.py
```

## Deploy (Heroku)

Web dyno (Flask), worker dyno (worker), Postgres addon. See `memory-bank/` for details.
