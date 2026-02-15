import secrets
from datetime import datetime, timedelta, timezone

from ...utils import normalize_phone


class AccessLinkService:
    def __init__(self, access_repo, employee_repo, site_repo, twilio_client_factory, host_url_builder):
        self.access_repo = access_repo
        self.employee_repo = employee_repo
        self.site_repo = site_repo
        self.twilio_client_factory = twilio_client_factory
        self.host_url_builder = host_url_builder

    def generate_access_token(self):
        for _ in range(5):
            candidate = secrets.token_urlsafe(32)
            if not self.access_repo.token_exists(candidate):
                return candidate
        return None

    @staticmethod
    def format_whatsapp_number(raw_phone: str):
        if not raw_phone:
            return None
        if raw_phone.startswith('0'):
            return '+972' + raw_phone[1:]
        return '+' + raw_phone

    def build_access_link_url(self, token: str):
        return f"{self.host_url_builder().rstrip('/')}/portal/{token}"

    def compose_message(self, employee_name, processing_month, url):
        return (
            f"שלום {employee_name},\n"
            f"להלן הקישור להעלאת כרטיסי העבודה עבור חודש {processing_month.strftime('%m/%Y')}:\n"
            f"{url}"
        )

    def create_access_request(self, *, business_id, site_id, employee_id, processing_month, user_id):
        token = self.generate_access_token()
        if not token:
            raise RuntimeError('Failed to generate access token')
        expires_at = datetime.now(timezone.utc) + timedelta(days=30)
        access_request = self.access_repo.create(
            token=token,
            business_id=business_id,
            site_id=site_id,
            employee_id=employee_id,
            processing_month=processing_month,
            created_by_user_id=user_id,
            expires_at=expires_at,
            is_active=True,
        )
        return access_request, self.build_access_link_url(token)

    def send_whatsapp(self, *, employee, access_request, from_number):
        raw_phone = normalize_phone(employee.phone_number)
        if not raw_phone:
            raise ValueError('Invalid phone number format')
        formatted_phone = self.format_whatsapp_number(raw_phone)
        if not formatted_phone:
            raise ValueError('Invalid phone number format')
        client = self.twilio_client_factory()
        message = client.messages.create(
            from_=from_number,
            body=self.compose_message(employee.full_name, access_request.processing_month, self.build_access_link_url(access_request.token)),
            to=f'whatsapp:{formatted_phone}',
        )
        return message
