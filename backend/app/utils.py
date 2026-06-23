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


def format_whatsapp_chat_id(phone: str):
    """Build a WhatsApp individual-DM chat id from a raw phone number.

    Mirrors the E.164 normalization used for site contractor sends
    (api/sites.py::_format_whatsapp_number) and returns the
    "{e164}@s.whatsapp.net" form the listener expects for direct messages.
    Returns None when the phone is empty/unusable.
    """
    digits = normalize_phone(phone)
    if not digits:
        return None
    if digits.startswith('0'):
        e164 = '+972' + digits[1:]
    else:
        e164 = '+' + digits
    return f'{e164}@s.whatsapp.net'
