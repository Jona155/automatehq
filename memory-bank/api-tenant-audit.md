# API Multi-Tenancy Audit

## Incident: Sites API 500 on Create

**Symptom:** `POST /api/sites` returned 500 when creating a new site. Frontend showed "Failed to create site" and "Failed to fetch sites" (500).

**Root cause:** The Sites API was implemented **without multi-tenancy**. The app is tenant-scoped: every user belongs to a `business_id`, and all domain data (sites, employees, users) has a `business_id` FK.

1. **Create (POST)**  
   `repo.create(**data)` was called with only `site_name` and optional `site_code`. The `Site` model requires `business_id` (NOT NULL). The DB raised an error → 500.

2. **List (GET)**  
   `get_sites()` and repo methods (`get_with_employee_count()`, `get_active_sites()`, `get_all()`) did **not** filter by `business_id`. So once create was fixed, list would have returned sites from all tenants (data leak).

3. **Uniqueness**  
   `get_by_name(site_name)` was global. Duplicate check should be per tenant: same site name is allowed in different businesses.

**Fix applied:**  
- Set `data['business_id'] = g.business_id` in `create_site()`.  
- Pass `business_id` into all list/count repo methods and filter by it.  
- Added `get_by_name_and_business(site_name, business_id)` and use it for conflict check.  
- For GET/PUT/DELETE by ID: load resource, then enforce `resource.business_id == g.business_id`; return 404 otherwise.  
- On update, `data.pop('business_id', None)` so client cannot change tenant.

## Right Way to Treat All APIs

- **Every** domain API that touches tenant-scoped models must follow the same pattern: list filtered by `business_id`, create sets `business_id` from `g.business_id`, single-resource ops verify `resource.business_id == g.business_id`, uniqueness is per tenant, and repositories accept/apply `business_id` where needed.
- **Request context:** All protected endpoints get tenant/user context from Flask `g` (set by `@token_required`). Use `g.business_id` for tenant scoping everywhere (not `g.current_user.business_id`).
- When adding a **new** domain API (or endpoint), check Users/Employees/Sites implementations and apply the rules in [system-patterns.md](system-patterns.md) (API Multi-Tenancy and Request Context sections).
- Do **not** assume “this is just CRUD” without tenant scoping: all models with `business_id` are tenant-scoped by design.
