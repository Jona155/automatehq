import os
import base64
import logging
import resend

logger = logging.getLogger(__name__)


def send_email_with_attachment(
    to: list[str],
    subject: str,
    html_body: str,
    attachment_bytes: bytes,
    attachment_filename: str,
) -> dict:
    """Send an email with a single file attachment via Resend.

    Raises:
        ValueError: If RESEND_API_KEY is not configured.
    """
    api_key = os.environ.get("RESEND_API_KEY")
    if not api_key:
        raise ValueError("RESEND_API_KEY environment variable is not set")

    resend.api_key = api_key

    params = {
        "from": os.environ.get("RESEND_FROM_EMAIL", "noreply@autohq.org"),
        "to": to,
        "subject": subject,
        "html": html_body,
        "attachments": [
            {
                "filename": attachment_filename,
                "content": base64.b64encode(attachment_bytes).decode("utf-8"),
            }
        ],
    }

    logger.info(f"Sending email to {to} with attachment '{attachment_filename}'")
    response = resend.Emails.send(params)
    logger.info(f"Email sent successfully: {response}")
    return response
