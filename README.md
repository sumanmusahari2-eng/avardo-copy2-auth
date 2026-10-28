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
