# App module: apps, APIs and backends

Load for anything with data, users or a server. Order of work: data model, API, auth, UI, hardening.

## Process
1. Data model first: entities, fields, relations, constraints. Write it into SPEC.md before code.
2. Migrations from day one. Never edit the database by hand.
3. API next: list endpoints with method, path, input schema, output schema, auth rule.
4. Auth and permissions before features that need them.
5. UI last, against the finished API, one vertical slice at a time.

## Rules
- Validate every input at the boundary with a schema (for example Zod or Pydantic). Reject, never silently fix.
- Authorization is checked on the server for every action, using the session, never a client-supplied user id.
- Hash passwords with a maintained library (argon2 or bcrypt); prefer an established auth library over hand-rolled auth. Never write your own cryptography.
- Secrets only from environment variables. Provide `.env.example`. Never log secrets or personal data.
- Use parameterized queries or the ORM. No string-built SQL.
- Return consistent error shapes and correct status codes. Do not leak internals.
- Paginate every list endpoint. Add indexes for fields used in filters and joins.
- Make writes idempotent where retries are likely (payments, webhooks). Verify webhook signatures.
- Add rate limiting to auth and expensive endpoints.

## Testing minimum
- Unit tests for business logic.
- One integration test per endpoint covering success, validation failure and unauthorized access.
- One end-to-end test per core user flow.
- Tests run with a single command documented in the README.

## Observability and delivery
- Structured logs with request ids; a health endpoint.
- Environment-specific config; no hardcoded URLs or keys.
- Dockerfile or host config, plus a deploy section in the README.

## Done when
The data model matches SPEC.md, every endpoint has a test for allowed and forbidden access, and the Security and Delivery sections of `gate.md` are ticked.
