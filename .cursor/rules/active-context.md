# Active Context

## Current Focus
Implementation of JWT Authentication and protection of API routes.

## Recent Changes
- Added `PyJWT` dependency.
- Configured `JWT_SECRET_KEY` and `JWT_ACCESS_TOKEN_EXPIRES`.
- Created `backend/app/auth_utils.py` for token generation and validation.
- Created `backend/app/api/auth.py` with `/login` and `/me` endpoints.
- Protected all existing API routes (`sites`, `employees`, `work_cards`, `users`) with `@token_required`.
- Created `backend/seed.py` to seed the initial admin user.

## Next Steps
- Integrate APIs with the Frontend.
- Implement Login page in Frontend.
- Handle JWT storage and attachment in Frontend requests.
