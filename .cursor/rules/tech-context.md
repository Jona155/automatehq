# Tech Context

## Stack
- **Backend**: Flask, SQLAlchemy, PostgreSQL, PyJWT.
- **Frontend**: (Planned) React/Vue/etc. (Need to confirm).
- **Worker**: Python script for background tasks.

## Environment Variables
- `SECRET_KEY`: Flask secret key.
- `DATABASE_URL`: PostgreSQL connection string.
- `JWT_SECRET_KEY`: Secret key for signing JWTs.
- `JWT_ACCESS_TOKEN_EXPIRES`: Token expiration time in seconds.
- `CORS_ORIGINS`: Allowed CORS origins.

## Development
- `backend/run.py`: Entry point for backend.
- `backend/seed.py`: Script to seed initial data (Admin).
