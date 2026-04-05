# Complete Setup Guide For GymVault

This guide is written in the exact order you should do things.

If you follow it slowly from top to bottom, you will finish the setup.

## First understand one important truth

There are 2 different things in your app:

1. Login verification for owners and staff.
2. WhatsApp messaging for gyms to message members.

They are not the same thing.

### Login verification

Use Email OTP.

This is the cheap part.

It does not need Indian DLT registration.

### Member messaging on WhatsApp

Use MSG91 + Meta WhatsApp Business onboarding.

This is the business messaging part.

It does not open normal WhatsApp chat on the owner phone.

After setup, the owner can send messages from GymVault only.

## Second important truth

You asked for this flow:

- owner enters mobile number in GymVault
- GymVault does everything automatically
- owner sends WhatsApp messages from GymVault only

The final sending part is possible.

The fully silent setup part is not fully possible.

Why:

- Meta still asks for one-time business verification
- MSG91 still asks for one-time onboarding/login
- the business number still needs OTP or voice verification once

So the real best flow is this:

1. Owner enters number in GymVault.
2. GymVault opens the setup workspace inside the app.
3. Owner completes the one-time MSG91 and Meta steps there.
4. After that, owner sends all WhatsApp messages from GymVault only.

That is now the correct goal.

## What is already implemented in your app now

### Email side

- Owner login can use Email OTP.
- Staff login can use Email OTP.
- Password reset can use Email OTP.
- Signup can verify email with OTP before account creation.

### WhatsApp side

- Gym business WhatsApp number can be saved in Settings.
- GymVault has an in-app WhatsApp onboarding workspace.
- GymVault can send approved WhatsApp templates from the app.
- Owner does not need to open normal WhatsApp after setup is complete.

## Setup order

Do it in this order only:

1. Set up Email OTP first.
2. Test login and signup email verification first.
3. Then set up MSG91 WhatsApp.
4. Then connect the first gym number.
5. Then create or sync approved templates.
6. Then send a WhatsApp test from GymVault.

If you try to do WhatsApp first while email/login is not clear, you will confuse yourself.

---

## Part 1: Set up Email OTP first

This part is for:

- signup email verification
- owner login OTP by email
- staff login OTP by email
- password reset email OTP

## Step 1. Choose an email provider

You need SMTP.

Simple meaning: a service that sends emails from your app automatically.

Easy options:

1. Gmail app password
2. Brevo SMTP
3. Zoho SMTP
4. Amazon SES

For testing, Gmail is okay.

For production, Brevo, Zoho, or your own domain mail is better.

## Step 2. Fill the SMTP values in your backend `.env`

Open your backend environment file and fill these values:

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

### Example for Gmail testing

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=yourgmail@gmail.com
SMTP_PASS=your_16_char_app_password
SMTP_FROM_NAME=GymVault
SMTP_FROM_EMAIL=yourgmail@gmail.com
PASSWORD_RESET_DELIVERY_MODE=email
```

Important:

- for Gmail, do not use your normal Gmail password
- use a Gmail App Password

## Step 3. Restart the backend

After saving `.env`, restart the backend server.

If you do not restart, the new SMTP values will not load.

## Step 4. Test signup email verification

Now do this:

1. Open Signup page.
2. Enter a new email address.
3. Click Send Verification Code.
4. Open the email inbox.
5. Copy the 6-digit OTP.
6. Paste it into the signup screen.
7. Click Verify Email.
8. Continue the signup steps.

If SMTP is not configured correctly, GymVault will show a preview OTP on screen.

That means the code path works, but email sending is still not live.

## Step 5. Test owner login Email OTP

Now do this:

1. Open Login page.
2. Choose Email OTP.
3. Enter the registered owner email.
4. Click Send Email OTP.
5. Open the email inbox.
6. Enter the OTP.
7. Click Verify & Continue.

## Step 6. Test staff login Email OTP

Do the same thing using a real staff account email.

## Step 7. Test forgot password email OTP

1. Open Login page.
2. Choose Email Password.
3. Click Forgot password.
4. Enter the registered email.
5. Get the email OTP.
6. Enter OTP and new password.

If all 3 tests work, your email side is ready.

---

## Part 2: Set up MSG91 for WhatsApp only

This part is only for member-facing WhatsApp messaging.

You do not need MSG91 SMS OTP if you are using Email OTP for login.

## Step 1. Create or open your MSG91 account

Log in to MSG91 Control Panel.

## Step 2. Get the WhatsApp auth key

Inside MSG91, find the WhatsApp API auth key.

You need this value in your backend.

## Step 3. Put the WhatsApp key in `.env`

```env
MSG91_WHATSAPP_AUTH_KEY=your_whatsapp_auth_key
```

If you are not using MSG91 SMS OTP anymore, these can stay empty or preview:

```env
MSG91_OTP_AUTH_KEY=
MSG91_OWNER_LOGIN_OTP_TEMPLATE_ID=
MSG91_OWNER_LOGIN_OTP_MODE=preview
```

## Step 4. Restart the backend again

Restart the backend after adding the WhatsApp key.

---

## Part 3: Connect the first gym WhatsApp number

This is the most confusing part, so do it slowly.

## Before you start, make sure you have these ready

You need:

1. The gym business mobile number.
2. Access to that number for OTP or voice verification.
3. Business details if Meta asks for them.
4. Owner available for 10 to 20 minutes.

## Step 1. Open the gym inside GymVault

Go to:

1. Settings
2. Integrations
3. Messaging / WhatsApp area

## Step 2. Enter the business WhatsApp number

Enter the gym business number in the Business WhatsApp Number field.

This should be the number that will send member reminders and templates.

## Step 3. Click Start In-App Setup

GymVault will:

1. save the number
2. open the WhatsApp onboarding workspace inside the app

You do not need to open normal WhatsApp.

## Step 4. In the workspace, open MSG91 Portal

Inside the in-app workspace:

1. open MSG91 Portal
2. log in to MSG91
3. go to WhatsApp onboarding

If embedding is blocked by the provider, use the popup button.

Still return to GymVault after finishing.

## Step 5. Open Meta Business step

Inside the same workspace:

1. open Meta Business
2. complete business verification if asked
3. connect the WhatsApp business number

This is the one-time provider step GymVault cannot silently skip.

## Step 6. Verify the phone number

Meta or MSG91 may ask for:

1. SMS OTP on the business number
2. voice call OTP on the business number

Complete that one-time verification.

## Step 7. Return to GymVault and click Refresh Connection Status

After verification is complete:

1. go back to the GymVault onboarding workspace
2. click Refresh Connection Status

You want the status to move toward Connected.

## Step 8. Check what status you see

### If status is Connected

Good. The number is ready.

### If status is Pending Connection

Meta or MSG91 still has something pending.

Wait a little and refresh again.

### If status is Error

Open MSG91 or Meta again from the workspace and finish the missing step.

---

## Part 4: Make WhatsApp sending work inside GymVault only

After the number is connected, you still need approved templates.

Without approved templates, WhatsApp sending will stay blocked.

## Step 1. Sync templates in GymVault

In the same Integrations area:

1. refresh integration status
2. check template sync status
3. sync or review template state

## Step 2. Make sure at least one template is approved

You need at least one approved template.

Until then, no live member messaging will work.

## Step 3. Send a test template

In GymVault:

1. choose an approved template
2. enter a recipient number
3. click Send Test Template

If the test arrives, then GymVault can now send WhatsApp messages from the app.

## Important: after setup, does the owner need to open WhatsApp?

No, not for normal sending.

After onboarding is complete, the owner can send member WhatsApp templates from GymVault only.

Normal daily sending does not require opening WhatsApp chat.

---

## Part 5: Exact daily flow for a gym owner

This is what the owner experience should look like.

### One-time setup day

1. Owner signs up and verifies email OTP.
2. Owner logs in with Email OTP.
3. Owner goes to Settings.
4. Owner enters gym WhatsApp number.
5. Owner completes one-time MSG91 + Meta onboarding inside GymVault.
6. Owner sends a test template.

### After setup is complete

1. Owner logs in with Email OTP.
2. Owner opens GymVault dashboard or messaging area.
3. Owner sends WhatsApp messages from GymVault.
4. Owner does not need to open normal WhatsApp.

---

## Part 6: What you should put in `.env`

Here is the practical minimum setup for your preferred flow.

```env
PASSWORD_RESET_DELIVERY_MODE=email

SMTP_HOST=smtp.yourprovider.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your_smtp_username
SMTP_PASS=your_smtp_password
SMTP_FROM_NAME=GymVault
SMTP_FROM_EMAIL=no-reply@yourdomain.com

MSG91_WHATSAPP_AUTH_KEY=your_whatsapp_auth_key

MSG91_OTP_AUTH_KEY=
MSG91_OWNER_LOGIN_OTP_TEMPLATE_ID=
MSG91_OWNER_LOGIN_OTP_MODE=preview
```

This gives you:

- email OTP for signup
- email OTP for login
- email OTP for password reset
- WhatsApp messaging through MSG91
- no dependence on SMS DLT for login OTP

---

## Part 7: Simple testing checklist

Do these one by one.

### Email checklist

1. Signup sends email OTP.
2. Signup verifies OTP.
3. Owner login Email OTP arrives.
4. Staff login Email OTP arrives.
5. Forgot password OTP arrives.

### WhatsApp checklist

1. Business WhatsApp number is saved.
2. In-app onboarding workspace opens.
3. MSG91 login works.
4. Meta verification completes.
5. Connection status becomes Connected.
6. Template status shows approved templates.
7. Test WhatsApp send works.

---

## Part 8: If something fails, check this exact list

### Problem: Email OTP is not arriving

Check:

1. `SMTP_HOST`
2. `SMTP_PORT`
3. `SMTP_USER`
4. `SMTP_PASS`
5. spam folder
6. whether backend was restarted

### Problem: Signup still shows preview OTP on screen

That means SMTP is not fully configured yet.

The signup flow works, but email delivery is still in preview mode.

### Problem: Login Email OTP is not arriving

Check whether the email entered is the same email saved on the owner or staff account.

### Problem: WhatsApp status never becomes Connected

Usually one of these is still incomplete:

1. Meta business verification
2. phone number verification
3. MSG91 onboarding step

### Problem: WhatsApp is connected but sending fails

Usually the template is not approved yet.

---

## Part 9: The final clean recommendation for your business

Use this final model:

1. Email OTP for signup and login.
2. MSG91 only for WhatsApp business messaging.
3. Do not depend on SMS OTP if DLT cost is a problem.
4. Let owners complete one-time WhatsApp onboarding inside GymVault.
5. After that, let them send everything from GymVault only.

That is the cheapest and cleanest setup for your case.