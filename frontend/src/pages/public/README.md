# Public pages

Unauthenticated frontend routes (no CMS login).

| Route | Component | Purpose |
|-------|-----------|---------|
| `/pay/fiuu/:token` | `FiuuPublicPayPage.jsx` | Guardian opens email payment link → loads FIUU form fields → POST to FIUU hosted pay |

Requires backend `GET /api/sms/payments/fiuu/public/:token` and `FIUU_FRONTEND_RETURN_URL` pointing at this frontend origin.
