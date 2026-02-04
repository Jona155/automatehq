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
    return digits
