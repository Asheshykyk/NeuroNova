# Future TRUSTTRACE E2E integration scaffold

This directory is a non-claiming scaffold for future real-backend Person 4
integration. It contains no live backend responses, credentials, approved REST
calls, WebSocket payload assumptions, ZIP fixture layout, or public contract
address.

Run the local readiness check with:

```sh
node --test tests/e2e/*.test.mjs
```

The check only confirms repository scaffolding and must not be reported as an
end-to-end pass. Real E2E coverage must wait for Person 2 read/WebSocket/export
approval and a separately provisioned test environment.
