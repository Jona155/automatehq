"""Canonical, importable business constants.

Kept in one place so values like the monthly hours target and the performance
band thresholds are defined exactly once and stay consistent everywhere.
"""

# Flat monthly worked-hours target per employee. Utilization is measured against
# this ceiling: utilization % = worked_hours / MONTHLY_TARGET_HOURS * 100.
# v1 uses a single global value for every employee (no pro-rating for
# partial-month / part-time). Per-business override is a P2 (would become a
# nullable Business column falling back to this constant).
MONTHLY_TARGET_HOURS = 236

# Performance bands. Thresholds are PLACEHOLDERS pending calibration against the
# real utilization distribution (PRD Open Question O1) — keep them trivially
# editable here. Expressed as utilization-% lower bounds:
#   >= BAND_HIGH_MIN            -> HIGH  (green)
#   BAND_MID_MIN .. HIGH_MIN    -> MID   (amber)
#   < BAND_MID_MIN              -> LOW   (red)
BAND_HIGH_MIN = 90
BAND_MID_MIN = 70

BAND_HIGH = 'HIGH'
BAND_MID = 'MID'
BAND_LOW = 'LOW'


def classify_band(utilization_pct):
    """Map a utilization percentage to a performance band.

    Boundaries are inclusive on the lower bound: exactly 90 -> HIGH,
    exactly 70 -> MID.
    """
    if utilization_pct >= BAND_HIGH_MIN:
        return BAND_HIGH
    if utilization_pct >= BAND_MID_MIN:
        return BAND_MID
    return BAND_LOW
