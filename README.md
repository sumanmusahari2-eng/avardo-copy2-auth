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

## Phase 1: orders & wallet

Coins: 1 coin = ₹1. Wallet payments deduct immediately and the order
becomes `paid` (awaiting delivery); WhatsApp orders stay `pending` until the
admin confirms payment. Order statuses: `pending` → `paid` → `delivered`,
and `pending`/`paid` → `cancelled`. Cancelling a paid wallet order refunds
it to the wallet. Only the admin (Sumanmusahari@gmail.com) may change order
status or decide top-up requests.

- `GET /api/wallet/me` — Bearer token. Returns `{ balance, ledger }`
  (latest 50 entries).
- `POST /api/wallet/topup-request` — Bearer token. Body `{ amount, note }`
  (1–100000 coins). Creates a pending top-up request for the admin to
  approve; approval credits the wallet.
- `POST /api/orders` — Bearer token. Body `{ game, pack, price, player_id,
  zone_id, payment_method }` where `payment_method` is `wallet` or
  `whatsapp`. Returns the order with code `CP2-<id>`. Wallet orders fail
  with 400 when the balance is short; nothing is created on failure.
- `GET /api/orders/me` — Bearer token. The signed-in user's orders, newest
  first.
- `GET /api/orders/:id` — Bearer token. The order, only for its owner or
  the admin (404 otherwise).
- `GET /api/admin/orders` — Bearer token, admin only. All orders, newest
  first, optional `?status=` filter, with the buyer's email.
- `POST /api/admin/orders/:id/status` — Bearer token, admin only. Body
  `{ status }` (`paid`, `delivered` or `cancelled`, following the allowed
  transitions above).
- `GET /api/admin/topup-requests` — Bearer token, admin only. All requests,
  pending first, with the buyer's email.
- `POST /api/admin/topup-requests/:id/decision` — Bearer token, admin
  only. Body `{ decision }` (`approved` or `rejected`); approval credits
  the wallet and writes a ledger entry.
