// Avardo Copy 2 — auth service (email + password login for the store).
// Serves the static storefront's sign-up / sign-in: register, login, me.
// Stateless JWT auth: the store keeps the token and sends it as a Bearer token.
// Env: DATABASE_URL (Neon Postgres), JWT_SECRET (long random string),
//      CORS_ORIGIN (comma-separated allowed origins; defaults to the Render store).
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

const app = express();
app.use(express.json({ limit: '32kb' }));

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || '';
const CORS_ORIGINS = (process.env.CORS_ORIGIN || 'https://avardo-official-copy-2.onrender.com')
  .split(',').map((s) => s.trim()).filter(Boolean);

if (!process.env.DATABASE_URL) console.warn('WARNING: DATABASE_URL is not set — auth routes will fail until it is.');
if (!JWT_SECRET) console.warn('WARNING: JWT_SECRET is not set — set a long random value before real use.');

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && CORS_ORIGINS.includes(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    return res.status(204).end();
  }
  next();
});

const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
  : null;

async function ensureSchema() {
  if (!pool) return;
  await pool.query(
    `CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );`
  );
}

// Tiny in-memory rate limiter for the auth routes (per IP, rolling window).
const hits = new Map();
function rateLimit(req, res, next) {
  const now = Date.now();
  const key = req.ip || 'unknown';
  const list = (hits.get(key) || []).filter((t) => now - t < 15 * 60 * 1000);
  list.push(now);
  hits.set(key, list);
  if (list.length > 30) return res.status(429).json({ error: 'Too many attempts, try again later.' });
  next();
}

function validEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function publicUser(row) {
  return { id: row.id, email: row.email, name: row.name, created_at: row.created_at };
}

function signToken(user) {
  return jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
}

function requirePool(res) {
  if (!pool) {
    res.status(503).json({ error: 'Auth service is not connected to a database yet.' });
    return false;
  }
  if (!JWT_SECRET) {
    res.status(503).json({ error: 'Auth service is not configured yet.' });
    return false;
  }
  return true;
}

app.get('/', (req, res) => res.json({ service: 'avardo-copy2-auth', ok: true }));
app.get('/api/health', (req, res) => res.json({ ok: true, db: !!pool }));

app.post('/api/auth/register', rateLimit, async (req, res) => {
  if (!requirePool(res)) return;
  const name = typeof req.body.name === 'string' ? req.body.name.trim().slice(0, 100) : '';
  const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = req.body.password;
  if (!validEmail(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
  if (typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }
  try {
    const hash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      'INSERT INTO users (email, password_hash, name) VALUES ($1, $2, $3) RETURNING id, email, name, created_at',
      [email, hash, name]
    );
    const user = publicUser(rows[0]);
    res.status(201).json({ user, token: signToken(user) });
  } catch (err) {
    if (err && err.code === '23505') {
      return res.status(409).json({ error: 'That email is already registered. Try signing in.' });
    }
    console.error('register failed:', err);
    res.status(500).json({ error: 'Could not create the account. Try again.' });
  }
});

app.post('/api/auth/login', rateLimit, async (req, res) => {
  if (!requirePool(res)) return;
  const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = req.body.password;
  if (!validEmail(email) || typeof password !== 'string') {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }
  try {
    const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (rows.length === 0) return res.status(401).json({ error: 'Invalid email or password.' });
    const ok = await bcrypt.compare(password, rows[0].password_hash);
    if (!ok) return res.status(401).json({ error: 'Invalid email or password.' });
    const user = publicUser(rows[0]);
    res.json({ user, token: signToken(user) });
  } catch (err) {
    console.error('login failed:', err);
    res.status(500).json({ error: 'Could not sign in. Try again.' });
  }
});

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token || !JWT_SECRET) return res.status(401).json({ error: 'Not signed in.' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Session expired. Sign in again.' });
  }
}

app.get('/api/auth/me', requireAuth, async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'Auth service is not connected to a database yet.' });
  try {
    const { rows } = await pool.query('SELECT id, email, name, created_at FROM users WHERE id = $1', [req.user.id]);
    if (rows.length === 0) return res.status(401).json({ error: 'Account not found.' });
    res.json({ user: publicUser(rows[0]) });
  } catch (err) {
    console.error('me failed:', err);
    res.status(500).json({ error: 'Could not load the account.' });
  }
});

ensureSchema()
  .catch((err) => console.error('schema setup failed (will retry per-request):', err))
  .finally(() => app.listen(PORT, () => console.log(`avardo-copy2-auth listening on ${PORT}`)));
