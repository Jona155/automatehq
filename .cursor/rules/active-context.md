# Active Context

## Current Focus
Refactoring Frontend components for better maintainability and fixing UI/UX issues.

## Recent Changes
- Refactored `SiteDetailsPage.tsx` into smaller components:
  - `SummaryStats`: Displays top-level statistics.
  - `EmployeesTab`: Handles employee listing and file uploads.
  - `ReviewTab`: Handles work card review and approval.
  - `MatrixTab`: Displays the hours matrix.
  - `UnknownUploadCard`: Handles unassigned uploads.
- Fixed module import issues in `SiteDetailsPage.tsx`.
- Added `PyJWT` dependency.
- Configured `JWT_SECRET_KEY` and `JWT_ACCESS_TOKEN_EXPIRES`.
- Created `backend/app/auth_utils.py` for token generation and validation.
- Created `backend/app/api/auth.py` with `/login` and `/me` endpoints.
- Protected all existing API routes (`sites`, `employees`, `work_cards`, `users`) with `@token_required`.
- Created `backend/seed.py` to seed the initial admin user.

## Next Steps
- Continue resolving any frontend integration issues.
- Verify full functionality of the refactored Site Details page.
- Implement Login page in Frontend.
- Handle JWT storage and attachment in Frontend requests.
