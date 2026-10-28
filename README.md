# Avardo Copy 2 — auth service

Email + password login backend for the Copy 2 store
(https://avardo-official-copy-2.onrender.com).

## Endpoints

- `GET /api/health` — service + database status
- `POST /api/auth/register` — `{ name?, email, password }` (password min 8 chars)
  → `201 { user, token }`, or 409 if the email is already registered
- `POST /api/auth/login` — `{ email, password }` → `{ user, token }`
- `GET /api/auth/me` — `Authorization: Bearer <token>` → `{ user }`

Tokens are JWTs (30 days). Passwords are bcrypt hashes — never stored plain.

## Environment

- `DATABASE_URL` — Postgres connection string (Neon). Required for auth routes.
- `JWT_SECRET` — long random string. Required for auth routes.
- `CORS_ORIGIN` — comma-separated allowed origins.
  Default: `https://avardo-official-copy-2.onrender.com`
- `PORT` — Render sets this automatically.

## Deploy (Render, free tier)

1. Push this folder to a GitHub repo.
2. Render → New → Web Service → that repo. Build: `npm install`,
   Start: `npm start`.
3. Set the env vars above. The service creates the `users` table on boot.
4. Put the service URL into the storefront as the auth API base, then
   redeploy the storefront.

Note: Render's free web service sleeps after inactivity, so the first
sign-in after idle takes a few seconds to wake up. Accounts and data live
in the Postgres database, not on the web service, so sleeping loses nothing.

## Google sign-in

- `GET /api/auth/google` — starts Google sign-in (redirects to Google).
- `GET /api/auth/google/callback` — Google redirects back here; the account
  is found or created by email, then the browser returns to the store with
  `#token=<jwt>` in the URL hash for the storefront to pick up.

Setup: in Google Cloud Console, create an OAuth client (Web application)
with redirect URI `<service-url>/api/auth/google/callback`, scopes openid,
email, profile; set the OAuth consent screen to Production so anyone can
sign in; set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` here.
`GOOGLE_REDIRECT_URI` is optional — it defaults to this service's own
callback URL.

## Store data (admin inside the store)

- `GET /api/store` — public live catalogue/settings. Returns
  `{ configured: false }` until an admin has saved, and the saved data after
  that. The storefront falls back to its built-in data when nothing is saved.
- `PUT /api/admin/store` — `Authorization: Bearer <token>`, admin only
  (the signed-in email must be Sumanmusahari@gmail.com). Body is the store
  data JSON (games, WhatsApp number, theme, support note, ...), saved as one
  row and served to all visitors by `GET /api/store`.
