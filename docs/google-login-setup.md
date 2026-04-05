# Google Login Setup

GymVault already includes the Google OAuth backend callback flow and the frontend login and signup buttons. To make production sign-in work, the Google Console settings and the backend environment variables must match the deployed URLs exactly.

## Google Console

Create or edit a Web application OAuth client in Google Cloud Console.

Authorized JavaScript origins:

- `https://gym-management-system-ruddy.vercel.app`

Authorized redirect URIs:

- `https://gym-management-system-4nfu.onrender.com/api/auth/google/callback`

Important:

- Do not use only the bare Render domain as the redirect URI.
- The redirect URI must include `/api/auth/google/callback`.
- If the consent screen is still in testing mode, add the Google accounts you want to use under Test users.

## Backend Environment Variables

Set these on the Render backend service:

- `APP_URL=https://gym-management-system-4nfu.onrender.com`
- `FRONTEND_URL=https://gym-management-system-ruddy.vercel.app`
- `CORS_ORIGIN=https://gym-management-system-ruddy.vercel.app`
- `GOOGLE_CLIENT_ID=your_google_client_id`
- `GOOGLE_CLIENT_SECRET=your_google_client_secret`
- `GOOGLE_REDIRECT_URI=https://gym-management-system-4nfu.onrender.com/api/auth/google/callback`

Notes:

- `GOOGLE_CLIENT_SECRET` should be stored only in Render environment variables. Do not commit it to the repository.
- `GOOGLE_REDIRECT_URI` is optional in code because the backend can derive it from `APP_URL`, but setting it explicitly avoids deployment drift.

## Frontend Environment Variables

Set this on the Vercel frontend project:

- `VITE_API_URL=https://gym-management-system-4nfu.onrender.com`

The frontend now also includes a production fallback to `https://gym-management-system-4nfu.onrender.com`, so Google OAuth and media URLs still resolve even if `VITE_API_URL` was not configured on Vercel.

`VITE_API_URL` is still the preferred setting because it keeps the deployment explicit and easier to change later.

## Frontend Behavior

The frontend now:

- Sends Google sign-in users through the login route.
- Sends Google sign-up users through the signup route.
- Returns OAuth failures to the correct screen instead of always dropping back to the default login view.

## Verification

After updating Google Console and Render environment variables:

1. Restart the backend service on Render.
2. Open the Vercel frontend.
3. Test `Continue with Google` from both login and signup.
4. Confirm successful auth lands on the dashboard.
5. Confirm cancellation returns to the same auth screen with an error message.