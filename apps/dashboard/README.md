# TRUSTTRACE dashboard

Standalone React, Vite, TypeScript, and Tailwind dashboard for the Person 4 workstream.

## Start locally

```sh
cd apps/dashboard
npm install
npm run dev
```

The Vite server prints its local URL, normally `http://localhost:5173`.

## Checks

```sh
npm run typecheck
npm run test
npm run build
```

## Data modes

DEMO is the default and uses only local fixture data. To start LIVE mode locally:

```sh
VITE_TRUSTTRACE_DATA_MODE=live npm run dev
```

Vite development and preview proxy `/api/v1` to the Vault at `http://localhost:3000/api/v1`. For a deployed build, serve `/api/v1` through a same-origin proxy or set `VITE_TRUSTTRACE_API_BASE_URL` to a Vault endpoint that permits the Dashboard origin. LIVE has no WebSocket configuration requirement.

LIVE reads sources, event metadata, selected event detail, batches, and Vault sequence gaps. Use Refresh to reload the current filter and Load more to follow the backend cursor. Event detail displays an exact hexadecimal preview of the returned bytes. Batch anchoring is server reported. Public checkpoints, recovery status, collection gaps, live push, and independent verification are unavailable in LIVE mode.
