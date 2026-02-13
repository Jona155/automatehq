from datetime import datetime, timezone
import re

def utc_now():
    return datetime.now(timezone.utc)

def normalize_phone(phone: str) -> str:
    if not phone:
        return ''
    digits = re.sub(r'\D', '', phone)
    if digits.startswith('972') and len(digits) >= 10:
        digits = '0' + digits[3:]
    elif digits and not digits.startswith('0') and len(digits) == 9:
        digits = '0' + digits
    return digits
