# Email OTP Setup For GymVault

Use this if you want email OTP for:

- owner login
- staff login
- signup email verification
- password reset

## Why this avoids DLT

Indian DLT registration applies to SMS delivery. It does not apply to normal SMTP email delivery.

That means you can use email OTP for owner and staff login without paying SMS DLT fees.

## What email OTP is good for

- owner login
- staff login
- signup email verification
- password reset OTP

## What email OTP does not replace

- member-facing WhatsApp reminders
- member-facing WhatsApp campaigns
- WhatsApp business onboarding in MSG91 and Meta

WhatsApp messaging still needs the MSG91 and Meta setup described in docs/msg91-setup.md.

## SMTP values to configure

Fill these values in your backend environment:

```env
SMTP_HOST=smtp.yourprovider.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your_smtp_username
SMTP_PASS=your_smtp_password
SMTP_FROM_NAME=GymVault
SMTP_FROM_EMAIL=no-reply@yourdomain.com
PASSWORD_RESET_DELIVERY_MODE=email
```

Once SMTP is configured:

- signup email verification sends real email automatically
- owner and staff Email OTP login sends real email automatically
- password reset OTP sends real email if `PASSWORD_RESET_DELIVERY_MODE=email`

## Low-cost providers you can use

- Gmail SMTP with an app password for testing
- Zoho Mail SMTP
- Brevo SMTP
- SMTP2GO
- Amazon SES

For production, using your own domain email address is better than sending from a free mailbox.

## Signup flow after setup

1. Open the Signup page.
2. Enter the new email address.
3. Click Send Verification Code.
4. Open the email.
5. Enter the 6-digit OTP.
6. Click Verify Email.
7. Continue the rest of signup.

## Login flow after setup

1. Restart the backend.
2. Open the GymVault login page.
3. Choose Email OTP.
4. Enter the owner or staff email already saved on the account.
5. Open the OTP email.
6. Enter the 6-digit code.

## Preview mode behavior

If SMTP is not configured yet, GymVault will still show a preview OTP on screen for Email OTP login.

That helps you test the login flow before connecting a real mail provider.

## Common issues

- No email received: check `SMTP_HOST`, `SMTP_PORT`, username, password, and spam folder.
- OTP still shown on screen: SMTP is not configured correctly, so GymVault is still in preview mode.
- Login says no account found: the email entered is not the one stored on that owner or staff account.