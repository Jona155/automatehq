# Project Brief

**AutomateHQ Admin Portal** — Mizhav monthly payroll processing from work card images.

## Goal

Replace manual workflow (WhatsApp/email/paper → human extraction → spreadsheets) with:

- Upload by site + month (single or batch)
- Auto extraction (OpenCV + OpenAI Vision)
- Admin review + corrections → approve
- Export payroll-ready CSV

## Scope

- **Phase 1:** Admin-only. No employee login, OTP, or employee uploads.
- Employees = DB records for matching and validation.

## Non-Goals

- Employee portals / self-upload
- OTP verification
- RBAC beyond "Admin"
- S3 or external storage (images in Postgres)

## MVP Success

Admin completes full flow per site: **upload → extract → review/correct → approve → export CSV**. Less admin time and fewer extraction errors than manual sheets.

## Phase 2 Ready (schema only)

`uploader_type`, `uploader_identity` on uploads; no Phase 2 features built.
