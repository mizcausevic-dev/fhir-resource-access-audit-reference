# Changelog

## [0.1] — 2026-05-30

### Added

- End-to-end Node.js reference implementation of the `fhir-resource-access-audit` spec.
- `FhirClient` — minimal FHIR R4 client with `live` (HAPI public test server) and `test` (fixtures/) modes.
- `applyVaultContract()` — HIPAA Safe-Harbor vault layer covering 6 Patient fields + Observation/Encounter subject.display (tokenize/mask/hash/drop).
- `EventBuilder` — hash-chained Suite-compliant event construction; canonical-JSON SHA-256, genesis `prev_hash` is 64 zeros, hash computed at emit-time.
- `verifyStream()` — re-validates produced stream against the spec's own JSON Schema *and* recomputes every event hash.
- Canonical 4-step access plan: Patient read → Observation search → Encounter search → Condition search.
- CLI (`bin/fhir-audit-reference`) with `--mode`, `--output`, `--patient-id`, `--source` flags; auto-verifies output unless `--verify=false`.
- Fixtures: `Patient-example`, `search-Observation`, `search-Encounter`, `search-Condition` for byte-stable test-mode output.
- Committed reference output `examples/sample-output-stream.ndjson` (5 events, 1 Patient + 2 Observations + 1 Encounter + 1 Condition).
- 7-test suite via `node --test` covering event count, schema, chain linkage, vault application, Decision Card pivot, byte-stability, and example freshness.
- GitHub Actions CI: install → build canonical example → run unit tests → pretty-print first event.

### Design notes

- `redaction_applied` is always emitted (empty array when no vault rule matches) so auditors can distinguish "vault considered, matched nothing" from "vault never ran".
- License is **AGPL-3.0**: the spec itself is MIT, but reference implementations across the Suite are AGPL-3.0 so they can be inspected, modified, and re-deployed under copyleft.
- Deterministic test-mode timestamp (`2026-05-29T14:30:00.000Z`) + sequential `event_id` (`0190fhir-NNNN`) keep the committed example byte-stable across CI runs.

### Not yet

- ed25519 signing per event (spec's optional `signature` field).
- SMART-on-FHIR OAuth + scope enforcement.
- Real vault provider adapters (Skyflow / Privacera / etc.).
- DocumentReference, MedicationRequest, AllergyIntolerance resource types.
