// reference.test.mjs — End-to-end tests for fhir-resource-access-audit-reference.
//
// All tests run in --mode=test (no network). These prove:
//   1. The orchestrator produces ≥4 events for the canonical access plan
//   2. Every event validates against the spec's JSON Schema
//   3. The hash chain links correctly from genesis (64 zeros) through last event
//   4. The vault contract was applied (every event has redaction_applied entries)
//   5. The committed example output is byte-stable across re-runs

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runEndToEnd, toNdjson } from "../src/orchestrator.mjs";
import { verifyStream } from "../src/verifier.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const FIXTURES = resolve(REPO_ROOT, "fixtures");
const EXAMPLE = resolve(REPO_ROOT, "examples/sample-output-stream.ndjson");

const FIXED_TS = "2026-05-29T14:30:00.000Z";

async function run() {
  return await runEndToEnd({
    mode: "test",
    fixturesDir: FIXTURES,
    patientId: "example",
    source: "rad-ai-chest-triage-prod",
    fixedTimestamp: FIXED_TS
  });
}

test("orchestrator produces at least 4 events for canonical plan", async () => {
  const events = await run();
  assert.ok(events.length >= 4, `expected ≥4 events, got ${events.length}`);
});

test("every event validates against the spec JSON Schema", async () => {
  const events = await run();
  const result = await verifyStream(events);
  assert.equal(result.errors.length, 0, `verification errors:\n${result.errors.join("\n")}`);
  assert.equal(result.ok, true);
});

test("hash chain links from genesis (64 zeros) through last event", async () => {
  const events = await run();
  assert.equal(events[0].prev_hash, "0".repeat(64), "first event must start chain from genesis");
  for (let i = 1; i < events.length; i++) {
    assert.equal(events[i].prev_hash, events[i - 1].hash, `event[${i}].prev_hash must match event[${i - 1}].hash`);
  }
});

test("vault contract was applied — redaction_applied is present on every event", async () => {
  // Reference impl emits redaction_applied even when empty: explicit "vault
  // contract considered, matched nothing" is more auditable than absent field.
  // The Patient event MUST have ≥1 redaction (it's the canonical PHI carrier).
  const events = await run();
  for (const event of events) {
    assert.ok(Array.isArray(event.redaction_applied), `event ${event.event_id} missing redaction_applied`);
    for (const r of event.redaction_applied) {
      assert.ok(["tokenize", "mask", "hash", "drop"].includes(r.action), `bad action: ${r.action}`);
    }
  }
  const patientEvent = events.find((e) => e.resource.type === "Patient");
  assert.ok(patientEvent, "expected at least one Patient event");
  assert.ok(patientEvent.redaction_applied.length >= 5, `Patient event must have ≥5 redactions (name+identifier+telecom+address+birthDate+contact); got ${patientEvent.redaction_applied.length}`);
});

test("Decision Card pivot is present on every event", async () => {
  const events = await run();
  for (const event of events) {
    assert.ok(event.decision_card_ref.startsWith("https://"), "decision_card_ref must be https URL");
    assert.equal(event.decision_card_ref, event.agent.ai_decision_card_url, "top-level decision_card_ref must equal agent.ai_decision_card_url");
  }
});

test("byte-stable output: re-running with same fixedTimestamp produces identical NDJSON", async () => {
  const a = toNdjson(await run());
  const b = toNdjson(await run());
  assert.equal(a, b, "deterministic test-mode output is not byte-stable across runs");
});

test("committed example output is in sync with current emitter", async (t) => {
  if (!existsSync(EXAMPLE)) {
    t.skip("examples/sample-output-stream.ndjson not yet generated (run `npm run build:example`)");
    return;
  }
  const expected = readFileSync(EXAMPLE, "utf8");
  const actual = toNdjson(await run());
  assert.equal(actual, expected, "examples/sample-output-stream.ndjson is out of date — regenerate with `npm run build:example`");
});
