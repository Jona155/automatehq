# Backend Performance SLOs and Scaling Baselines

## Scope
This document defines baseline performance guardrails for sites matrix and batch export endpoints.

## SLO Targets

### Latency SLOs (p95)
- `GET /api/sites/<id>/matrix`: **<= 700ms** for sites up to 200 active employees.
- `GET /api/sites/summary/export-batch`: **<= 4.0s** for up to 25 active sites / 2,500 total active employees.
- `GET /api/sites/salary-template/export-batch`: **<= 5.0s** for up to 25 active sites / 2,500 total active employees.

### Query-Budget SLOs (single-tenant baseline dataset)
The CI budget tests enforce the following maximum SQL query counts:
- `GET /api/sites/<id>/matrix`: **12 queries**.
- `GET /api/sites/summary/export-batch`: **20 queries**.
- `GET /api/sites/salary-template/export-batch`: **20 queries**.

A CI failure indicates a likely N+1 regression or an unbounded data-access path.

## Metrics and Logs

### Structured route logs
The sites API now emits structured route logs with:
- `duration_ms`
- `site_count`
- `employee_count`
- `query_count`
- `output_type`

### Service-level metrics hooks
- Matrix build latency histogram.
- Export generation latency histogram.
- WhatsApp batch outcome counters (`sent`, `failed`, `skipped`).

The instrumentation is lightweight and supports both Prometheus (when `prometheus_client` is installed) and OpenTelemetry metrics APIs (when configured).

## Expected Scaling Limits
Current implementation is tuned for:
- Up to ~25 sites in one batch export request.
- Up to ~100 employees per site on average.
- Up to ~2,500 employees total in one workbook generation operation.

Beyond these limits, expect degraded response times and increased memory use during workbook construction. Use asynchronous export jobs for higher-volume workloads.

## CI Enforcement
Baseline query-budget tests are defined in:
- `backend/tests/test_sites_query_budget.py`

Run locally:

```bash
python -m unittest backend.tests.test_sites_query_budget
```

Any query-count increase above thresholds should be treated as a performance regression unless accompanied by an explicit budget update and justification in PR notes.
