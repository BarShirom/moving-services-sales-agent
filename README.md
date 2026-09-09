# Rick & GO Sales Agent

A local sales-agent project for Rick & GO, a moving business. This initial milestone contains only the frontend/backend scaffold and a health endpoint.

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
npm run build
npm start
```

The client builds to client/dist and the server to server/dist. npm start runs the compiled backend only; it does not serve the client. For a local client build preview, run npm run preview --workspace client.

## Structure and Decisions

- client/: React, Vite, and strict TypeScript; a minimal project title only.
- server/src/app.ts: Express app and health route, without opening a port.
- server/src/server.ts: process entry point and HTTP listener.
- Root npm workspaces: one install and lockfile for both packages.
- Separate TypeScript configurations: browser code uses bundler resolution; backend code uses Node ESM resolution.

## Planned v0.1

A local conversation simulator for refrigerator moves and deterministic demo pricing. Future move/item models should support additional item types. The workflow must preserve provided information, ask only relevant missing questions, and require human approval for every v0.1 quote. An LLM must never determine final prices.

Lead models, extraction, pricing, OpenAI, MongoDB, WhatsApp, and authentication are intentionally not implemented in this milestone.
