from contextlib import ContextDecorator
from sqlalchemy import event


class QueryCounter(ContextDecorator):
    """Count SQL statements executed on a SQLAlchemy engine within a scope."""

    def __init__(self, engine):
        self.engine = engine
        self.count = 0
        self._enabled = False

    def _before_cursor_execute(self, conn, cursor, statement, parameters, context, executemany):
        self.count += 1

    def __enter__(self):
        if self.engine is not None:
            event.listen(self.engine, 'before_cursor_execute', self._before_cursor_execute)
            self._enabled = True
        return self

    def __exit__(self, exc_type, exc, tb):
        if self._enabled:
            event.remove(self.engine, 'before_cursor_execute', self._before_cursor_execute)
        return False


class _NoopCounter:
    def labels(self, **kwargs):
        return self

    def inc(self, value=1):
        return None


class _NoopHistogram:
    def labels(self, **kwargs):
        return self

    def observe(self, value):
        return None


class SitesMetrics:
    """Lightweight wrapper for optional Prometheus/OpenTelemetry metrics."""

    def __init__(self):
        self.matrix_latency = _NoopHistogram()
        self.export_latency = _NoopHistogram()
        self.whatsapp_outcomes = _NoopCounter()

        self._init_prometheus()
        self._init_opentelemetry()

    def _init_prometheus(self):
        try:
            from prometheus_client import Counter, Histogram

            self.matrix_latency = Histogram(
                'sites_matrix_build_latency_seconds',
                'Latency of building site work-hour matrices',
                ['approved_only', 'include_inactive'],
            )
            self.export_latency = Histogram(
                'sites_export_generation_latency_seconds',
                'Latency of generating site export payloads',
                ['output_type', 'endpoint'],
            )
            self.whatsapp_outcomes = Counter(
                'sites_whatsapp_batch_outcomes_total',
                'Count of WhatsApp batch outcomes by status',
                ['status'],
            )
        except Exception:
            return

    def _init_opentelemetry(self):
        try:
            from opentelemetry import metrics as otel_metrics

            meter = otel_metrics.get_meter('automatehq.sites')
            self._otel_matrix_latency = meter.create_histogram(
                'sites.matrix_build_latency.seconds',
                unit='s',
                description='Latency of matrix building',
            )
            self._otel_export_latency = meter.create_histogram(
                'sites.export_generation_latency.seconds',
                unit='s',
                description='Latency of export generation',
            )
            self._otel_whatsapp_outcomes = meter.create_counter(
                'sites.whatsapp_batch_outcomes',
                unit='1',
                description='WhatsApp batch outcomes',
            )
        except Exception:
            self._otel_matrix_latency = None
            self._otel_export_latency = None
            self._otel_whatsapp_outcomes = None

    def observe_matrix_build_latency(self, duration_s: float, approved_only: bool, include_inactive: bool):
        self.matrix_latency.labels(
            approved_only=str(approved_only).lower(),
            include_inactive=str(include_inactive).lower(),
        ).observe(duration_s)
        if self._otel_matrix_latency:
            self._otel_matrix_latency.record(
                duration_s,
                {
                    'approved_only': str(approved_only).lower(),
                    'include_inactive': str(include_inactive).lower(),
                },
            )

    def observe_export_generation_latency(self, duration_s: float, output_type: str, endpoint: str):
        self.export_latency.labels(output_type=output_type, endpoint=endpoint).observe(duration_s)
        if self._otel_export_latency:
            self._otel_export_latency.record(
                duration_s,
                {
                    'output_type': output_type,
                    'endpoint': endpoint,
                },
            )

    def increment_whatsapp_batch_outcome(self, status: str, value: int = 1):
        self.whatsapp_outcomes.labels(status=status).inc(value)
        if self._otel_whatsapp_outcomes:
            self._otel_whatsapp_outcomes.add(value, {'status': status})


sites_metrics = SitesMetrics()

