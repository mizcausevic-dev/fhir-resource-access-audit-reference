# fhir-resource-access-audit-reference

[![ci](https://github.com/mizcausevic-dev/fhir-resource-access-audit-reference/actions/workflows/ci.yml/badge.svg)](https://github.com/mizcausevic-dev/fhir-resource-access-audit-reference/actions/workflows/ci.yml)
[![license: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE)
[![node: ≥20](https://img.shields.io/badge/node-%E2%89%A520-brightgreen.svg)](package.json)

Node.js **reference implementation** of the
[`fhir-resource-access-audit`](https://github.com/mizcausevic-dev/fhir-resource-access-audit)
specification — proves the audit-stream spec is implementable end-to-end against
real HL7 FHIR R4 semantics, not just example JSON.

## What this repo proves

The spec repo defines a JSON Schema and a single canonical example. This repo
closes the loop with code:

1. **Read** — fetches FHIR resources (Patient, Observation, Encounter, Condition)
   from a configurable FHIR R4 server.
2. **Vault** — applies a HIPAA-Safe-Harbor vault contract that tokenizes,
   masks, hashes, or drops PHI fields *before* the resource is handed to any AI
   tool.
3. **Emit** — produces a Suite-compliant hash-chained NDJSON audit stream,
   one event per resource access.
4. **Verify** — re-validates the produced stream against the spec's own
   published JSON Schema *and* recomputes every event hash from canonical-JSON.

CI runs this pipeline on every push. A green build is evidence the spec is
implementable, not just well-typed.

## Quick start

```bash
npm install
npm run build:example   # writes examples/sample-output-stream.ndjson, verifies it
npm test                # 7 tests across orchestrator + schema + chain + vault
```

## Two modes

| Mode    | Source                                              | Use                                                                                           |
| ------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `test`  | `fixtures/` (committed deterministic FHIR samples)  | CI-safe, no network. Output is byte-stable across runs.                                       |
| `live`  | `https://hapi.fhir.org/baseR4` (public test server) | End-to-end against a real FHIR R4 endpoint. Synthetic test data only — never real PHI.        |

```bash
# Test mode — deterministic, CI-safe
node src/cli.mjs --mode=test --output=examples/sample-output-stream.ndjson

# Live mode — hits HAPI public FHIR test server
node src/cli.mjs --mode=live --patient-id=example --output=output/live-stream.ndjson
```

## What an event looks like

The first event in `examples/sample-output-stream.ndjson` (Patient read,
genesis of the chain):

```json
{
  "event_id": "0190fhir-0001",
  "timestamp": "2026-05-29T14:30:00.000Z",
  "kind": "fhir.resource.read",
  "source": "rad-ai-chest-triage-prod",
  "patient_ref": "Patient/example",
  "resource": { "type": "Patient", "id": "example", "version_id": "1" },
  "action": "R",
  "outcome": "0",
  "agent": {
    "ai_tool_card_url": "https://vendor-aiclinician.example/.well-known/ai-tool-cards/aiclinician-7.x.json",
    "ai_decision_card_url": "https://stmary-hospital.example/.well-known/decisions/STMARY-DEC-2026-HEALTH-0042.json"
  },
  "decision_card_ref": "https://stmary-hospital.example/.well-known/decisions/STMARY-DEC-2026-HEALTH-0042.json",
  "prev_hash": "0000000000000000000000000000000000000000000000000000000000000000",
  "purpose_of_use": "TREAT",
  "redaction_applied": [
    { "field": "Patient.name",       "action": "tokenize" },
    { "field": "Patient.identifier", "action": "tokenize" },
    { "field": "Patient.telecom",    "action": "mask"     },
    { "field": "Patient.address",    "action": "tokenize" },
    { "field": "Patient.birthDate",  "action": "hash"     },
    { "field": "Patient.contact",    "action": "drop"     }
  ],
  "hash": "a8117abd4358b615a31bae863d7e14323ceb12be201931760f9df3009c6a438b"
}
```

`prev_hash` of the next event equals this event's `hash` — that's the chain.

## How it's organized

```
src/
  fhir-client.mjs       # FHIR R4 client (live + test modes)
  vault.mjs             # HIPAA Safe-Harbor vault contract (tokenize/mask/hash/drop)
  event-builder.mjs     # Hash-chained Suite-compliant event construction
  orchestrator.mjs      # End-to-end: fetch → vault → emit
  verifier.mjs          # Re-run spec's schema + recompute hash chain
  cli.mjs               # CLI entry point
schema/
  fhir-resource-access-event.schema.json   # copied verbatim from the spec repo
fixtures/               # deterministic FHIR R4 resources for test-mode
examples/
  sample-output-stream.ndjson              # committed reference output
tests/
  reference.test.mjs    # node --test runner, 7 tests
```

## Design choices

- **Always emit `redaction_applied`** (even when empty). An auditor can
  distinguish "vault contract considered, matched nothing" from "vault contract
  never ran". The spec permits both shapes — the reference impl picks the
  auditable one.
- **Canonical JSON hashing** matches the spec verifier exactly: object keys
  sorted lexicographically, no whitespace. `hash = sha256(canonical_json(event
  minus hash field))`.
- **Hash chain at emit time, not as a post-processor.** Once an event is
  written, there's no window where an un-chained event exists.
- **`patient_ref` derived from the tokenized resource**, so vault tokenization
  of Patient.identifier is reflected in the audit event itself when applicable.
- **Deterministic test-mode timestamp + event_id** so the committed example
  output is byte-stable across re-runs (CI catches drift).

## Scope (and what's intentionally not in scope)

This is a reference implementation, not a hardened FHIR client. Production use
would add:

- SMART-on-FHIR OAuth + scope enforcement
- Real vault provider integration (Skyflow, Privacera, etc.) — this impl
  uses deterministic SHA-256 stand-in tokens
- ed25519 signing per event (the spec's optional `signature` field) — see
  [pulse-signing](https://kineticgain.com/.well-known/pulse-signing.json) for
  the Suite's signing scheme
- Caching, retries, circuit-breakers
- Background batching, persistent NDJSON sinks, downstream sinks (Kinesis,
  Kafka, Loki, etc.)

What's in scope is the *audit-stream emission contract* — that one is fully
covered.

## Related

- [`fhir-resource-access-audit`](https://github.com/mizcausevic-dev/fhir-resource-access-audit)
  — the spec this implements
- [`phi-vault-contract-profile`](https://github.com/mizcausevic-dev/phi-vault-contract-profile)
  — the HIPAA-Safe-Harbor vault contract this enforces
- [`hipaa-readiness-evidence-bundle`](https://github.com/mizcausevic-dev/hipaa-readiness-evidence-bundle)
  — readiness bundle the emitted stream is evidence for
- [Kinetic Gain Protocol Suite](https://suite.kineticgain.com/) — the
  umbrella

## Compliance language

This repository is **reference scaffolding for HIPAA-relevant audit
evidence**. It is not a HIPAA-compliant or HIPAA-certified product, and
producing a verified audit stream is not an attestation of HIPAA compliance.
Compliance posture depends on the buyer's full control environment, business
associate agreements, and external attestation.

## License

[AGPL-3.0](LICENSE) — the spec is MIT, but reference implementations of the
Kinetic Gain Protocol Suite are AGPL-3.0 so they can be inspected, modified,
and re-deployed under copyleft.
