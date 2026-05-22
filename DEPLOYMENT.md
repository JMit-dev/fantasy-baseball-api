# API Licensing (Per-Service API Keys)

This project uses a simple licensing model:

- Each client service gets its own API key (for example: `draft-kit`).
- License state is binary: `active` or `inactive`.
- No tiers, quotas, or feature flags.
- Protected data routes are throttled per API key.
- Protected routes require `x-api-key`.

## How It Works

1. An operator creates the API key.
2. The service (like Draft Kit) stores that key in its secret manager.
3. The service sends `x-api-key` on every API request.
4. Middleware authenticates the key hash and checks status:
   - `active` -> request allowed
   - `inactive` -> `403 Forbidden`
   - missing/invalid -> `401 Unauthorized`

## Protected Routes

- `/api/players/*`
- `/api/valuations`
- `/api/api-keys/me`

Public route:

- `/api/health`

## Environment Variable

Set in API server environment:

```bash
API_KEY_PEPPER=your-secret-pepper-value
```

The pepper is combined with the raw key before hashing and is not stored in MongoDB.

Optional testing flag:

```bash
DISABLE_API_KEY_AUTH=true
```

Use only for local testing; keep this `false` in production.

Optional default per-key throttle:

```bash
API_KEY_RATE_LIMIT_PER_MINUTE=500
```

Each key inherits this limit unless an operator sets an override.

## Operator Key Management

From repo root:

```bash
npm run api-keys -- create draft-kit
npm run api-keys -- rotate draft-kit
npm run api-keys -- set-status draft-kit inactive
npm run api-keys -- set-status draft-kit active
npm run api-keys -- set-rate-limit draft-kit 750
npm run api-keys -- clear-rate-limit draft-kit
npm run api-keys -- show draft-kit
npm run api-keys -- delete draft-kit
```

Notes:

- `create` and `rotate` print the raw key once. Store it immediately.
- Raw keys are never stored in MongoDB; only `keyHash` is stored.

## Draft Kit Integration Example

Valuations are stateless. Draft Kit must send the current league state in the
request body to `POST /api/valuations`. The API does not persist league records.

### 1) Store key in Draft Kit environment

```bash
FANTASY_BASEBALL_API_KEY=draft-kit_xxxxxxxxxxxxxxxxx
```

### 2) Call players endpoint

```bash
curl -X GET "http://localhost:3001/api/players?position=SP" \
  -H "x-api-key: $FANTASY_BASEBALL_API_KEY"
```

### 3) Verify identity/key status

```bash
curl -X GET "http://localhost:3001/api/api-keys/me" \
  -H "x-api-key: $FANTASY_BASEBALL_API_KEY"
```

Expected response shape:

```json
{
  "success": true,
  "data": {
    "id": "67c1...",
    "serviceName": "draft-kit",
    "status": "active",
    "keyPrefix": "abc123def4",
    "rateLimitPerMinute": null,
    "effectiveRateLimitPerMinute": 500,
    "createdAt": "2026-02-28T12:00:00.000Z",
    "updatedAt": "2026-02-28T12:00:00.000Z"
  }
}
```

Protected data routes currently use a fixed 60-second window. The default limit is
`500 requests per minute per API key`, unless the key has an operator-set override.

## Maintenance Runbook

### Rotate key

- Run `rotate`.
- Update Draft Kit secret.
- Redeploy Draft Kit.
- Confirm with `/api/api-keys/me`.

### Disable access immediately

- Run `set-status <service> inactive`.
- Service starts receiving `403` on protected routes.

### Re-enable access

- Run `set-status <service> active`.

### Delete service key

- Run `delete <service>`.
- All requests with that key will fail with `401 Invalid API key`.
- Use when you want permanent removal instead of reversible deactivation.

### Troubleshooting

- `401 Missing API key`: header was not sent.
- `401 Invalid API key`: wrong key value.
- `403 API key is inactive`: key exists but is disabled.

## Compliance / Pre-Merge Checks

From repo root:

```bash
npm run build
npm test
npm run lint
```

## Runtime Commands

- `npm start` runs the local live-reload server.
- `npm run start:prod` runs the compiled production server from `dist/app.js`.
