# Oksskolten Spec — Authentication

> [Back to Overview](./01_overview.md)

## Authentication

### Approach

A hybrid of four methods: password authentication with JWT + bcryptjs, passwordless authentication with WebAuthn/Passkey, social login with GitHub OAuth, and API key authentication for external tool access. Password/Passkey/OAuth can be independently enabled/disabled (with at least one always remaining active). API keys are always available once created.

### DB Schema

```sql
CREATE TABLE users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  token_version INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE credentials (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  credential_id   TEXT NOT NULL UNIQUE,
  public_key      BLOB NOT NULL,
  counter         INTEGER NOT NULL DEFAULT 0,
  device_type     TEXT NOT NULL,
  backed_up       INTEGER NOT NULL DEFAULT 0,
  transports      TEXT,
  created_at      TEXT DEFAULT (datetime('now'))
);

CREATE TABLE api_keys (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT    NOT NULL,
  key_hash     TEXT    NOT NULL UNIQUE,
  key_prefix   TEXT    NOT NULL,
  scopes       TEXT    NOT NULL DEFAULT 'read',
  last_used_at TEXT,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);
```

### Initial Setup (User Creation)

When the `users` table is empty, accessing the app in a browser displays the initial setup screen (`SetupPage`) instead of the login screen.

**Flow:**

1. Frontend: detects `setup_required: true` via `GET /api/auth/methods` → displays `SetupPage`
2. User enters email, password, and password confirmation, then submits
3. `POST /api/auth/setup` creates the account (atomic INSERT: `WHERE NOT EXISTS (SELECT 1 FROM users)`)
4. On success → issues a JWT and auto-logs in
5. If a user already exists, returns 403 (creating a second user is not allowed)

**Notes:**

- Initial setup via Passkey is not supported. Since WebAuthn registration requires an authenticated session, the user must first create an account with a password, then add a Passkey from the settings screen
- `account_name` is automatically saved to the `settings` table using the registered email as the initial value on the first `GET /api/settings/profile` call (can be changed from the settings screen)

### Password Authentication Flow

```
1. Frontend: checks auth status via GET /api/me (with Authorization header)
   - 401 → displays LoginPage (AuthGate component)
2. Sends email/password to POST /api/login
3. Server: checks auth_password_enabled setting ('0' → 403)
4. Server: looks up email in users table, compares with bcryptjs
5. On success → generates JWT (includes email + token_version in payload)
6. Frontend: saves token to localStorage → revalidates /api/me via SWR mutate → displays app
7. Logout → removes token from localStorage → navigates to login screen
```

### Passkey Authentication Flow

```
1. Frontend: checks available auth methods via GET /api/auth/methods
2. If Passkey is available, shows "Log in with Passkey" button
3. User clicks the button
4. Retrieves challenge via GET /api/auth/login/options
5. Browser's WebAuthn dialog appears
6. User authenticates with Passkey
7. Verifies via POST /api/auth/login/verify
8. Server: matches challenge, updates counter, issues JWT
9. Frontend: saves token to localStorage → displays app
```

### Passkey Registration Flow

```
1. Settings screen → auth tab → "Add Passkey" button
2. Retrieves challenge via GET /api/auth/register/options (requires authentication)
3. Browser's WebAuthn registration dialog appears
4. User registers Passkey
5. Verifies via POST /api/auth/register/verify (requires authentication)
6. Server: saves public key, counter, and device info to credentials table
```

### GitHub OAuth Authentication Flow

```
1. Click "Log in with GitHub" button on the login screen
2. Send window.location.origin to POST /api/oauth/github/authorize
3. Server: generates GitHub authorization URL with arctic, stores state in memory
4. Frontend: window.location.href = authorization URL (redirects to GitHub)
5. User clicks Authorize on GitHub
6. GitHub → redirects to GET /api/oauth/github/callback?code=xxx&state=yyy
7. Server: validates state → exchanges code for access_token → fetches GitHub user info
8. Server: checks against allowed users (if not configured, only the OAuth App owner)
9. Server: issues JWT → generates one-time exchange code (60-second TTL)
10. Redirects to /?oauth_code=<exchange_code>
11. AuthGate: detects oauth_code → exchanges for JWT via POST /api/oauth/github/token
12. Frontend: saves token to localStorage → SWR mutate → displays app
```

Security considerations:
- JWT is never placed in the URL (only the one-time exchange code)
- Exchange code has a 60-second TTL and is single-use (no replay)
- Client ID/Secret are stored in the `settings` table (zero additional env vars)
- Can be dynamically toggled ON/OFF from the settings screen

### JWT Token

- Algorithm: HS256
- Expiration: 30 days
- Payload: `{ email, token_version }`
- Transport: `Authorization: Bearer <token>` header
- Frontend storage: `localStorage` (`auth_token` key)
- Signing secret: persisted in DB (`settings` table). Can be overridden with the `JWT_SECRET` environment variable
- On 401 response: frontend automatically discards the token and redirects to the login screen
- Invalidation via `token_version`: incrementing `token_version` on password change invalidates all existing sessions

### WebAuthn Configuration

- `rpName`: `'Oksskolten'`
- `rpID`: dynamically derived from `Origin` / `Referer` headers (Vite proxy compatible)
- `residentKey`: `'preferred'`
- `userVerification`: `'preferred'`
- Challenge TTL: 60 seconds (managed in memory)

### Lockout Prevention

Invariant: **at least one authentication method is always enabled**

| Action | Allowed when |
|---|---|
| Disable password authentication | Passkey > 0 OR GitHub OAuth enabled |
| Delete last Passkey | Password authentication enabled OR GitHub OAuth enabled |
| Disable GitHub OAuth | Password authentication enabled OR Passkey > 0 |
| Clear GitHub OAuth settings (when it is the only auth method) | Blocked |

### Startup Guard

```typescript
// AUTH_DISABLED is only allowed in development
if (process.env.AUTH_DISABLED === '1' && process.env.NODE_ENV !== 'development') {
  process.exit(1)
}

// JWT_SECRET: env var > DB-stored value > auto-generate new one
const jwtSecret = process.env.JWT_SECRET || getOrCreateJwtSecret()
```

### Password Reset (CLI)

If the password is forgotten, it can be reset via a CLI script with direct server access. In a self-hosted environment, server access implies identity, so no additional authentication such as email verification is required.

```bash
npx tsx scripts/reset-password.ts
```

- Interactively enter a new password
- If there is only one user, they are auto-selected; if multiple, select by number
- Increments `token_version` to invalidate all existing sessions

### API Key Authentication

API keys provide programmatic access for external scripts, bots, and monitoring tools. Unlike JWT/Passkey/OAuth (which are for interactive user sessions), API keys are long-lived bearer tokens with scoped permissions.

**Key format:** `ok_` prefix + 40 hex characters (e.g., `ok_6ed6d44c17a82e3af429d384ef7baa04d6268917`)

**Storage:** Only the SHA-256 hash of the key is stored in the `api_keys` table. The plaintext key is shown once at creation and never again (same pattern as GitHub personal access tokens).

**Authentication flow:**

```
1. External script sends request with Authorization: Bearer ok_<key>
2. Server detects ok_ prefix → hashes the key with SHA-256
3. Looks up hash in api_keys table
4. If found: sets authUser = 'apikey:<id>', records last_used_at
5. Checks scope: read-only keys can only make GET requests
6. Non-GET with read scope → 403
```

**Scopes:**

| Scope | Allowed methods |
|---|---|
| `read` | GET only |
| `read,write` | GET, POST, PATCH, DELETE |

Scope enforcement is applied at the plugin level via `requireWriteScope` preHandler hook, so no individual route changes are needed.

**Management:** API keys are managed from Settings → Security → API Tokens section, or via the `/api/settings/tokens` endpoints.

### Local Development

Skip authentication checks with `AUTH_DISABLED=1`. Only effective when `NODE_ENV=development`.

### Rate Limiting

| Endpoint | Limit |
|---|---|
| `POST /api/login` | 5 req/min |
| `POST /api/auth/login/verify` | 5 req/min |
| `GET /api/oauth/github/callback` | 10 req/min |
| `POST /api/oauth/github/token` | 5 req/min |
| All other APIs | 100 req/min (global) |

### Security

- No CSRF risk since cookies are not used (tokens are explicitly sent as Authorization headers)
- Write APIs (POST / PATCH / DELETE) require `Content-Type: application/json`; otherwise return `415 Unsupported Media Type`
- XSS protection: React's automatic escaping + Markdown sanitization with DOMPurify
- WebAuthn challenges are consumed after a single use (replay attack prevention)
- WebAuthn counter verification for clone detection
- bcryptjs cost 12 (sufficient computational cost)
- GitHub OAuth: uses a one-time exchange code instead of putting JWT in the URL (prevents leakage via logs, Referer, and browser history)
- GitHub OAuth: CSRF prevention via the state parameter (5-minute TTL)
- GitHub OAuth: exchange code has a 60-second TTL and is single-use (no replay)
- API keys: `ok_` prefix enables secret scanning tools (e.g., GitHub) to detect leaked keys
- API keys: only SHA-256 hashes are stored; plaintext is shown once at creation
- API keys: scope enforcement via HTTP method check at plugin level (read-only keys cannot mutate data)
- API keys: `last_used_at` tracking for audit purposes
