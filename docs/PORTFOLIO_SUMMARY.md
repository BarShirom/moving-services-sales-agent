# Portfolio summary

## Project title

Moving Services Sales Agent

## 2-line summary

A human-in-the-loop AI sales workflow that turns Hebrew customer messages into structured moving leads and explainable pricing recommendations.
Built with React, TypeScript and Node.js, it keeps final quotes under owner control and tracks customer acceptance separately from scheduling.

## Problem

Moving inquiries arrive as incomplete, out-of-order messages. Inventory, access and service details affect the quote, while an incorrect assumption can underprice the work or create an expectation the business cannot meet.

## Solution

An LLM extracts schema-constrained facts. A deterministic requirements engine collects missing details, and a versioned pricing engine reports calculated components and omitted costs. The owner reviews or adjusts a final quote; contextual acceptance records the agreed scope and leaves coordination pending.

## My role

Independently designed and built the application: React customer/owner views, TypeScript domain models, Express API, OpenAI extraction boundary, deterministic pricing, quote workflow, regression tests, eval runner and evidence documentation. Rick & GO provides the current pilot's moving-business context.

## Technical highlights

- Separate client/server npm workspaces with strict TypeScript and modular domain logic.
- Explicit unknown values, conservative fact merging, independent pickup/dropoff access and deterministic requirement selection.
- Versioned pricing evaluations, owner decisions and scope snapshots; stale-action checks and duplicate-acceptance protection.
- Mobile-first Hebrew RTL interface with an opt-in, reproducible offline demo.

## AI engineering highlights

- OpenAI Responses API and Structured Outputs with Zod validation and conversion into restricted fact patches.
- Bounded context based on structured state and the actual previous question; no model-owned business lifecycle.
- Deterministic pricing and mandatory human approval, including explicit finalization of omitted costs.
- Offline workflow evals and regressions based on observed conversation failures; no claim that mocked tests measure live extraction accuracy.

## Business impact / intended value

Designed to reduce repetitive intake questions, retain customer details, expose unpriced work and help an owner review quotes consistently. These are intended benefits, not measured production outcomes. No revenue, adoption, conversion or time-saving metric is claimed.

## Current status

Working local, single-session v0.1 demo. Verification on 2026-10-07: **419 automated tests passed** (379 server, 40 frontend); **24 of 26 conversation evals passed**, with two future-service cases not run. All six historical pricing cases are evaluated, but none qualifies for a complete whole-job accuracy score.

The evidence registry has **29 records and 23 readiness categories**. Pricing remains provisional. There is no authentication, persistent database, WhatsApp delivery, maps integration or scheduling. Acceptance means commercial agreement awaiting manual coordination, not a booked move. See the [README](../README.md) for setup, limits and validation commands.

## Interview talking points

- Separate probabilistic extraction from deterministic business decisions.
- Explain why a partial subtotal and an approved commercial total are different records.
- Walk through a changed-scope reply and why it invalidates the previous quote.
- Show how unavailable information stays unknown without causing a repeated-question loop.
- Distinguish fixture-driven workflow correctness, live extraction quality and pricing accuracy.

Detailed answers: [INTERVIEW_NOTES.md](INTERVIEW_NOTES.md).

## CV bullet options

- Independently built a React/TypeScript/Node.js sales-agent demo covering Hebrew lead intake, owner-reviewed pricing, versioned quotes and contextual customer acceptance.
- Integrated OpenAI Responses API Structured Outputs with Zod validation and bounded context to convert customer messages into structured facts without delegating pricing or approval to the LLM.
- Designed deterministic, versioned pricing with component breakdowns and omitted-cost tracking, requiring explicit human finalization before a partial subtotal becomes a customer quote.
- Established an offline evaluation and regression suite with 419 passing tests and 24 passing conversation evals, covering state preservation, off-script replies and stale-quote protection.

Counts are a dated verification snapshot; rerun the repository checks before reusing them later. The final bullet describes automated workflow coverage, not live-model accuracy.

## LinkedIn project description

Independently built Moving Services Sales Agent, a human-in-the-loop AI workflow informed by a moving-business pilot. The React/TypeScript/Node.js demo converts Hebrew conversations into structured leads using OpenAI Structured Outputs, then applies deterministic requirements and provisional pricing rules. Owners explicitly finalize quotes, while versioned scope checks protect customer acceptance and keep coordination separate from booking. The project includes offline evals, regression tests and a pricing evidence registry; it is a local engineering demo, not a production deployment.

## GitHub description and topics

Suggested repository description:

> Human-in-the-loop AI sales agent for moving services with structured lead extraction, deterministic pricing, owner approval and eval-driven workflows.

Suggested topics:

`ai-agent` · `openai` · `typescript` · `react` · `nodejs` · `express` · `structured-outputs` · `human-in-the-loop` · `llm` · `ai-engineering`

These are copy-ready suggestions only. No GitHub repository settings are changed by this documentation.
