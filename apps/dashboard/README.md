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

## Data boundary

The dashboard uses only the typed adapter in `src/data/mockAdapter.ts`. Every record is marked `DEMO DATA`. No backend, WebSocket, blockchain RPC, or `@trusttrace/core` integration exists yet.

`Anchored · API reported` describes mock service metadata. `Independently verified` remains reserved for a future auditor result that includes a successful direct-RPC chain lookup.
