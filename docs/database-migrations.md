# Database Migration Guide

This guide describes how to manage database schema changes using Alembic and Flask-Migrate in the AutomateHQ project.

## Overview

We use **Alembic** (via **Flask-Migrate**) to version control our database schema. This ensures that:
1.  Schema changes are reproducible across environments (dev, staging, prod).
2.  We can roll back changes if something goes wrong.
3.  We have a history of how the database evolved.

## Workflow: Making Schema Changes

### 1. Update Models

Modify the SQLAlchemy models in `backend/app/models/`.
*   Add new classes for new tables.
*   Add new fields to existing classes.
*   Update constraints/indexes.

### 2. Generate Migration Script

Run the following command to auto-generate a migration script based on your model changes:

```bash
flask --app backend.run db migrate -m "Description of change"
```

*   `backend.run`: Points to the entry point of the application.
*   `-m`: A short, descriptive message (e.g., "add_user_phone", "create_audit_table").

### 3. Review the Migration Script

**ALWAYS** review the generated file in `migrations/versions/`.
*   Check that the `upgrade()` function does exactly what you expect.
*   Check that the `downgrade()` function reverses the changes.
*   **Warning**: Alembic does not detect all changes automatically (e.g., table name changes, some constraint changes). You may need to edit the script manually.

### 4. Apply Migration (Local)

Apply the changes to your local development database:

```bash
flask --app backend.run db upgrade
```

### 5. Verify

*   Check that the database tables look correct.
*   Run the application to ensure nothing is broken.
*   Run `python -m backend.verify_schema` if applicable.

### 6. Commit

Commit the new migration file (in `migrations/versions/`) and your model changes to Git.

## Best Practices

*   **Backup**: Always backup the database before running migrations in production.
*   **Atomic Changes**: Keep migrations small and focused. Don't mix unrelated schema changes.
*   **Non-Destructive**: Avoid dropping columns or tables if possible. If you must, consider a multi-step process (deprecate -> optional -> remove).
*   **Data Migration**: If you need to migrate *data* (e.g., move data from one column to another), write a separate migration or use a data migration script, not just a schema change.
*   **Test Downgrades**: Ensure `downgrade()` works, in case you need to revert.

## Troubleshooting

*   **"Target database is not up to date"**: Run `flask db upgrade` to sync your DB with the latest migration.
*   **Diverging Revisions**: If multiple developers create migrations at the same time, you may need to merge heads. Alembic will warn you.

## Directory Structure

*   `backend/app/models/`: SQLAlchemy model definitions.
*   `migrations/versions/`: The versioned migration scripts.
*   `migrations/env.py`: Alembic configuration.
