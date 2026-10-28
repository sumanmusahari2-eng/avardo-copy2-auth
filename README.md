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

## Phase 3: Busan (1gamestopup) connection

- `POST /api/games/check-id` — public, rate-limited. Body `{ game, pack,
  player_id, zone_id? }`. The backend resolves the pack's Busan product
  from the admin-saved catalogue and validates the player ID, returning
  `{ mapped, valid, username, player_id, zone_id }`. Unmapped packs return
  `{ mapped: false }`; a missing API key returns `{ configured: false }`
  — checkout is never blocked by the ID check.
- `GET /api/admin/busan/status` — Bearer token, admin only. Returns
  `{ configured, balance, currency }` (or `{ configured: false }` when
  no key is set) so the admin can confirm the connection and wallet.
- `GET /api/admin/busan/products` — Bearer token, admin only. The Busan
  catalogue (`productId`, `productName`, USD price, cached 10 minutes)
  for picking pack mappings.
- `POST /api/admin/orders/:id/fulfil` — Bearer token, admin only. Retries
  Busan fulfilment for a paid order (used after a failed attempt, once
  the key, balance or mapping is fixed).

Auto-fulfilment: when an order becomes `paid` (admin marks it paid, or a
wallet order is created paid), the backend looks up the pack's
`busanProductId` in the saved catalogue. If the pack is mapped and the
key is set, it validates the player first, then places the Busan order
(USD wallet). On success the order flips to `delivered` automatically;
on failure it stays `paid` with `busan_status='failed'` and the error
recorded, so the admin can retry or deliver manually. Unmapped packs and
a missing key simply skip fulfilment — delivery stays manual, as before.
One Busan order per Copy 2 order, and an order already marked
`busan_status='success'` is never re-sent. Order responses include
`busan_status`, `busan_order_id` and `busan_error`.

Env: `BUSAN_API_KEY` — the 1gamestopup.com API key. Never logged,
never returned to the browser, never written to a file. Without it the
whole Busan layer degrades gracefully (see above).

## Phase 4: best sellers + coupons

- `GET /api/stats/best-sellers` — public, aggregate only. Games ranked by
  delivered-order count (from the orders table), top 10.
- `POST /api/coupons/validate` — Bearer token. Body `{ code, price }`.
  Returns `{ valid, discount, final_price }` (or `valid: false` with an
  error). Checking does not consume the coupon; placing an order with
  `coupon_code` validates and consumes it in the same transaction, and the
  order stores the final price plus `coupon_code` and `discount`.
- `GET /api/admin/coupons` — Bearer token, admin only. All coupons.
- `POST /api/admin/coupons` — Bearer token, admin only. Body `{ code,
  kind, value, max_uses, expires_at }` where `kind` is `percent` (1–100)
  or `flat` (₹); `max_uses` and `expires_at` are optional (null = no
  limit). Codes are stored uppercased.
- `POST /api/admin/coupons/:id/toggle` — Bearer token, admin only. Body
  `{ active }` to switch a coupon on or off.
