# Rick & GO Sales Agent

A local sales-agent project for Rick & GO, a moving business. The project contains the frontend/backend scaffold, a health endpoint, and the core Lead State domain model.

## Requirements

Node.js 20.18+ and npm 9+. The scaffold uses Vite 6 for compatibility with Node.js 20.18.

## Setup and Development

From the project root:

```sh
npm install
npm run dev:server
```

In a second terminal:

```sh
npm run dev:client
```

Client: http://localhost:5173 (Vite selects another port if occupied).
Backend: http://localhost:3001. Set PORT to change the backend port.

```sh
curl http://localhost:3001/api/health
```

Expected response:

```json
{"status":"ok","service":"Rick & GO Sales Agent","version":"0.1"}
```

On Windows PowerShell, use npm.cmd if script execution policy blocks npm.ps1.

## Validation and Production Build

```sh
npm run typecheck
npm test
npm run build
npm start
```

The client builds to client/dist and the server to server/dist. npm start runs the compiled backend only; it does not serve the client. For a local client build preview, run npm run preview --workspace client.

## Structure and Decisions

- client/: React, Vite, and strict TypeScript; a minimal project title only.
- server/src/app.ts: Express app and health route, without opening a port.
- server/src/server.ts: process entry point and HTTP listener.
- server/src/domain/lead.ts: plain TypeScript domain types with explicit nulls for unknown collected values.
- server/src/domain/createLead.ts: creates independent empty leads with UUIDs and matching UTC timestamps.
- server/tests/lead.test.ts: domain default and serialization tests using Node's built-in runner via tsx. Tests are typechecked separately and excluded from production output.
- Root npm workspaces: one install and lockfile for both packages.
- Separate TypeScript configurations: browser code uses bundler resolution; backend code uses Node ESM resolution.

## Planned v0.1

A local conversation simulator for refrigerator moves and deterministic demo pricing. Future move/item models should support additional item types. The workflow must preserve provided information, ask only relevant missing questions, and require human approval for every v0.1 quote. An LLM must never determine final prices.

Extraction, pricing, OpenAI, MongoDB, WhatsApp, authentication, and domain API/frontend integration are intentionally not implemented in this milestone.

## Domain Conventions

Collected fields are required properties whose unknown values are null, not undefined. For elevator and assembly/disassembly needs, null means unknown, false means confirmed no, and true means confirmed yes. Floor 0 is a known ground floor. Empty items/messages arrays mean no entries recorded yet; they do not establish that a move has no items.

Item types remain strings to support future moving items without refrigerator-specific fields. Dimensions are individually nullable numbers in centimeters. Requested date/time use local YYYY-MM-DD and HH:mm strings; record timestamps use ISO 8601 UTC strings. These formats and units are conventions, not runtime validation.

Lead statuses and message senders are string unions. The model does not enforce status transitions or automatically update updatedAt; future workflow code will own those actions. Missing information will be derived from current state, never stored as a missingFields array.
