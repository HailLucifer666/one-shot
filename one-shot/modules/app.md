# App & API Security Pack (Adversarial Traps)

Load for any backend, API, auth, or data-handling project. Focus on the exact defects that survive unit tests and cause rework.

## Mandatory Adversarial Probes (write as executable tests)

1. **IDOR / Ownership Bypass:**
   - Create resource as User A, then `GET` / `PATCH` / `DELETE` it as User B. Must return `403` or `404`, never `200`.
   - Derive actor identity strictly from the verified session/token — never trust a client-supplied `userId` or `ownerId` in body/query.
2. **Auth Bypass:**
   - Hit every protected endpoint with (a) no auth header, (b) malformed token, (c) expired/wrong-secret token. Must return `401`/`403`.
   - Set `protectedPath` in `one-shot-work/contract.json` so `scripts/verify.mjs` probes it live.
3. **Malformed Input & Error Leakage:**
   - `POST` invalid JSON (`{not-json`), wrong types, negative/zero amounts, and oversized payloads. Must return `400`/`422` with a consistent JSON error body — never `500`, never a stack trace, file path, or SQL error.
4. **Stored / Reflected XSS:**
   - Submit `<img src=x onerror=alert(1)>` and `"><script>alert(1)</script>` in text fields. Stored values must be escaped on HTML render (or served with `Content-Type: application/json` + `X-Content-Type-Options: nosniff`).
5. **SSRF (whenever accepting a URL):**
   - Reject non-`http(s)` schemes and block loopback/link-local/private targets (`127.0.0.1`, `::1`, `169.254.169.254`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`) after DNS resolution, not just on the raw URL string.
6. **Injection & Secrets:**
   - Parameterized queries only (zero string-interpolated SQL).
   - Secrets from env vars only; ship `.env.example`; ensure `.gitignore` ignores `.env` itself (not just `.env.local`).
   - Password hashing via `argon2`, `bcrypt`, or `crypto.scrypt` with per-user salt — never `md5`/`sha256` or hand-rolled crypto.
