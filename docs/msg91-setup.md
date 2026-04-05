# MSG91 Setup For GymVault

This project now uses MSG91 for WhatsApp messaging, and can optionally still use MSG91 for SMS OTP.

- per-gym WhatsApp messaging

Owner and staff login no longer has to depend on SMS. GymVault can now use email OTP for owner and staff sign-in, which avoids Indian DLT registration for that login flow.

## Reality check

The exact flow you asked for is only partly possible.

What GymVault can do automatically:

- store each gym's business WhatsApp number in Settings
- use one platform MSG91 account for all gyms
- sync already connected WhatsApp numbers from MSG91
- send approved WhatsApp templates after the number is active
- send owner login OTP through email if SMTP is configured
- optionally still send owner login OTP from one platform MSG91 OTP setup

What GymVault cannot do silently through the public MSG91 and Meta flow:

- create your MSG91 auth keys without you logging into MSG91
- verify a business on Meta without Meta asking for business details, documents, and OTP
- activate a gym's WhatsApp number if that number has never completed provider onboarding

So the correct real-world flow is:

1. You create the platform keys one time in MSG91.
2. Gym owner enters their business number in GymVault.
3. That number still must complete MSG91 plus Meta onboarding once.
4. After that, GymVault can send messages automatically.

## What you configure once

For owner and staff login OTP, you now have two choices:

1. Preferred low-cost option: configure SMTP and use email OTP.
2. Optional SMS option: keep MSG91 OTP if you already want SMS.

See docs/email-otp-setup.md for the email OTP path.

For MSG91, do these steps one time in your own MSG91 account.

1. Sign in to MSG91 Control Panel.
2. Open the OTP section.
3. Create one OTP template for owner login.
4. Copy the OTP auth key.
5. Copy the OTP template ID.
6. Open the WhatsApp section.
7. Copy the WhatsApp auth key.

These are platform-level values. You do not create separate auth keys for every gym owner.

If you only want email OTP login and WhatsApp messaging, you can skip the MSG91 OTP template and OTP auth key entirely.

## If you are stuck on auth keys

The code cannot create the MSG91 auth keys for you. Those keys come from your MSG91 account.

Important MSG91 limitation:

- even if MSG91 support gets temporary account access, their own help guide says they still cannot access the Authkey page because it is protected by two-factor authentication

That means the auth keys must ultimately be copied by you from inside your own MSG91 login.

If you cannot find them:

1. Sign in to MSG91 Control Panel.
2. Search the help center for authentication key or authkey.
3. If still blocked, use MSG91 support or their onboarding call and ask them to stay on the call while you open the auth key page yourself.

## OTP template to create

Use a simple OTP message like this:

```text
Your GymVault login OTP is ##otp##. It is valid for 10 minutes.
```

The important part is `##otp##` because MSG91 replaces that with the real code.

## Environment variables to fill

Put these values in your backend environment file:

```env
MSG91_OTP_AUTH_KEY=your_otp_auth_key
MSG91_WHATSAPP_AUTH_KEY=your_whatsapp_auth_key
MSG91_OWNER_LOGIN_OTP_TEMPLATE_ID=your_owner_login_template_id
MSG91_OWNER_LOGIN_OTP_MODE=msg91
```

If you want to keep testing without real SMS, leave `MSG91_OWNER_LOGIN_OTP_MODE=preview`.

If you switch owner login to email OTP, SMTP becomes the important config instead of DLT-backed SMS. See docs/email-otp-setup.md.

## What happens per gym

Each gym uses its own business WhatsApp number.

1. Gym owner enters their business WhatsApp number in GymVault Settings.
2. That number must be connected in MSG91 and verified in Meta.
3. After approval, GymVault can sync the number and send approved templates.

Gym owners do not need their own MSG91 account for this.

The only shared platform account is yours.

## What you do for each gym number

1. Open MSG91 WhatsApp onboarding.
2. Add the gym's business phone number.
3. Complete the Meta verification flow for that number.
4. Wait until the number shows as active or connected.
5. Go to GymVault Settings and save the same number for that gym.
6. Open the Integrations page again so GymVault can sync status.

This onboarding can be shown inside a provider flow or popup in future, but the owner still has to approve Meta and number verification. That part cannot be skipped.

## Template rule

GymVault now sends approved WhatsApp templates, not random free-text WhatsApp messages.

That means:

- templates must exist in MSG91
- templates must be approved before live sending works
- campaign sends will stay blocked until a template is approved

## First live test

After login OTP and WhatsApp are configured:

1. Restart the backend.
2. Open the owner login page.
3. Switch to email OTP login if you are avoiding SMS.
4. Send OTP and verify that email arrives.
5. Open one gym's Settings page.
6. Save the business WhatsApp number.
7. Use the test-send card with an approved template.

## If something does not work

- Email OTP not coming: check SMTP settings and the owner's registered email address.
- SMS OTP not coming: check `MSG91_OWNER_LOGIN_OTP_MODE`, auth key, template ID, and phone format.
- WhatsApp number not connecting: the business number is probably not fully verified in MSG91 or Meta yet.
- Template send blocked: the selected template is still pending or rejected.
- App still showing preview OTP: SMTP or MSG91 live delivery is not fully configured yet.

## Important limitation

Gym owners do not need their own MSG91 account for login OTP, but each gym WhatsApp business number still needs a one-time provider and Meta verification before live messaging can work.