"""Flask CLI commands."""
import click

from .extensions import db


def _format_value(value):
    if not value:
        return '—'
    if value.get('status'):
        return value['status']
    return '—' if value.get('hours') is None else f"{value['hours']:g}"


_OUTCOME_LABELS = {
    'applied': 'APPLY',
    'already_matches': 'ALREADY IN DATA',
    'skipped_not_in_report': 'SKIP (employee not in this report)',
    'blocked': "KEEP AS OVERLAY (day holds another site's data)",
}


def register_cli(app):
    @app.cli.group('report-edits')
    def report_edits():
        """Maintenance for edits saved in the site report editor."""

    @report_edits.command('migrate')
    @click.option('--apply', 'apply_changes', is_flag=True,
                  help='Write the changes. Without it this is a dry run: nothing is saved.')
    @click.option('--business', 'business_code', default=None, help='Limit to one business code.')
    def migrate(apply_changes, business_code):
        """Move edits saved by the old report editor into work card day entries.

        Dry run by default. Each site-month is verified: the values its reports
        show must be identical before and after, otherwise that site-month is
        left untouched and reported. Safe to run again — migrated edits are
        skipped.
        """
        from .models.business import Business
        from .models.sites import Site
        from .services.sites import report_adjustments_service as svc

        business_id = None
        if business_code:
            business = Business.query.filter_by(code=business_code).first()
            if business is None:
                raise click.ClickException(f'No business with code {business_code!r}')
            business_id = business.id

        groups = svc.pending_adjustment_groups(business_id)
        click.echo(('APPLYING' if apply_changes else 'DRY RUN (nothing will be saved)')
                   + f' — {len(groups)} site-month(s) with edits waiting to be migrated')
        totals = {}
        failed = 0
        for group_business_id, site_id, month in groups:
            site = db.session.get(Site, site_id)
            click.echo(f'\n{site.site_name} · {month:%Y-%m}')
            savepoint = db.session.begin_nested()
            try:
                outcomes = svc.apply_pending_adjustments(group_business_id, site, month)
                savepoint.commit()
            except svc.MigrationMismatch as exc:
                savepoint.rollback()
                failed += 1
                click.echo('  FAILED VERIFICATION — left untouched. The report would have changed:')
                for diff in exc.differences:
                    click.echo(f"    employee {diff['employee_id']} day {diff['day']}: "
                               f"{_format_value(diff['before'])} -> {_format_value(diff['after'])}")
                continue
            for item in outcomes:
                totals[item['outcome']] = totals.get(item['outcome'], 0) + 1
                extra = ' + new manual card' if item['created_manual_card'] else ''
                click.echo(
                    f"  {item['employee_name'] or item['employee_id']} · day {item['day']}: "
                    f"{_format_value(item['previous'])} -> {_format_value(item['value'])}"
                    f"  [{_OUTCOME_LABELS[item['outcome']]}{extra}]"
                )
            click.echo('  verified: reports identical before and after')

        click.echo('\nSummary: ' + (', '.join(f'{count} {name}' for name, count in sorted(totals.items())) or 'nothing to do')
                   + (f', {failed} site-month(s) failed verification' if failed else ''))
        if apply_changes:
            db.session.commit()
            click.echo('Saved.')
        else:
            db.session.rollback()
            click.echo('Dry run — nothing was saved. Re-run with --apply to write these changes.')
