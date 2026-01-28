# Tech Context

## Stack

| Layer | Tech |
|-------|------|
| Frontend | React 18, Vite, TypeScript (use `import type` for types when verbatimModuleSyntax is on) |
| Backend | Flask, SQLAlchemy, Alembic |
| Data Access | Repository Pattern (Generic Base + Domain Repos) |
| DB | PostgreSQL (Heroku) |
| Queue | Postgres table + Python polling worker |
| Extraction | OpenCV, OpenAI Vision |
| Hosting | Heroku (web + worker dynos, Postgres addon) |

## Storage

Images as `BYTEA` in Postgres. No S3.

## Env

`DATABASE_URL`, `OPENAI_API_KEY`, `SECRET_KEY`, etc. See `.env.example`.
