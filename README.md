# Rick & GO Sales Agent

A local sales-agent project for Rick & GO, a moving business. The project contains the frontend/backend scaffold, a health endpoint, the core Lead State domain model, and a deterministic requirements engine.

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

Lead statuses and message senders are string unions. Ordinary field edits do not automatically update updatedAt. The readiness helper updates it when collection readiness changes. Missing information is derived from current state, never stored as a missingFields array.

## Requirements Engine (Milestone 3)

- server/src/domain/createMoveItem.ts creates items with explicit unknown defaults and independent dimensions.
- server/src/domain/requirements/types.ts defines requirement IDs, per-item context, results, and question references.
- server/src/domain/requirements/evaluateRequirements.ts derives requirements and offers updateLeadReadiness.
- server/src/domain/requirements/nextQuestion.ts selects at most two unanswered questions from one location or item in natural Hebrew.
- server/tests/requirements.test.ts covers collection, conditional rules, photos, quantities, readiness, and question selection. npm test runs all test files.

evaluateRequirements(lead, context?) returns all requirements, missingRequired, pendingReview, readyForPricing, and nextQuestion without changing the lead. Each result has a typed ID, optional item index, PRICING/REVIEW stage, MISSING/SATISFIED/NOT_APPLICABLE status, and a conditional flag. Item indices refer to the current evaluation only; reevaluate after reordering items. Derived results should not be persisted on Lead.

The next question prioritizes items, pickup, dropoff, date, then item details. Within the selected group it includes only missing fields. Pending photos are requested after pricing questions are complete. A requirement needing internal human policy (item.support) has no customer question, so nextQuestion can be null while readiness is false.

### Item and Context Assumptions

Supported requirement profiles are refrigerator and box, including box-only moves. Refrigerator readiness requires an item type, sufficient size information, both cities/addresses/floors/elevator answers, and a requested date. A single refrigerator's unknown quantity does not block readiness or get silently changed to 1. Boxes always require a positive integer quantity; null is unknown and 0 is invalid, not an unknown default. Ordinary boxes do not require dimensions.

sizeCategory is an explicit, accepted size/type classification entered by a caller or human. A nonblank classification or three positive dimensions supplies sufficient refrigerator size information. Free-text description is preserved but not interpreted. Actual business size categories still need agreement before pricing is implemented. Partial dimensions without a size category trigger questions for only the missing measurements; with neither, the engine asks for size/type information first.

RequirementContext can mark quantity, exact dimensions, disassembly, or assembly as relevant for a specific item, and can require special access notes. These flags are caller-provided context, not inferred from text or from elevator=false. Use the same context for evaluation and readiness updates. Exact-dimension context overrides sufficient size categories when an access issue needs measurements. No distance, worker count, or time-estimate questions are generated; distance will be derived from addresses later. Requested time is optional at this stage.

Wardrobe and bed profiles demonstrate size and assembly conditions, and washing_machine demonstrates optional dimensions. These and unknown item types have a blocking item.support requirement until their policies are approved and implemented; they cannot silently pass as supported moves. No prices are calculated.

### Photos and Readiness

MoveItem.photoStatus is REQUIRED, RECEIVED, or NOT_APPLICABLE. The item factory defaults refrigerators to REQUIRED and other/unknown types to NOT_APPLICABLE; callers changing an item's type should also reassess its photo policy. REQUIRED means the photo is still pending. RECEIVED is a caller assertion of receipt, not an uploaded file or an assessment of image quality. No uploads, storage references, or image analysis are implemented.

Photos are review requirements and do not block initial pricing readiness. READY_FOR_PRICING requires every applicable PRICING requirement to be satisfied. It is not quote approval: all v0.1 quotes still require human approval. updateLeadReadiness returns a lead with a changed status/timestamp only when moving between COLLECTING_INFORMATION and READY_FOR_PRICING; it can revert readiness after information is removed, and preserves all later lifecycle statuses. It does not send messages or quotes.
