# Product Context

## Why

Mizhav processes monthly payroll from employee work card photos. Manual extraction is slow and error-prone.

## Flow

1. Admin picks **month** + **site**.
2. Uploads work card images (batch or single).
3. System extracts: name, passport, days 1–31 (from/to/total), status, flags.
4. Match to employee (passport exact → assign; else unassigned).
5. Admin reviews (image + editable table), fixes, approves.
6. Export CSV: row-per-day-per-employee (Month, Site, Employee, Passport, Day, From, To, Total Hours).

## UX

- Organized by site + month.
- Split-screen review: zoomable image | editable 31-day table.
- Validate HH:MM and totals before approve.
- CSV = approved only by default; optional include unapproved, optional all sites.
