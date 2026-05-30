// orchestrator.mjs — End-to-end: fetch FHIR resources → apply vault contract
// → emit hash-chained audit events → return NDJSON stream.
//
// This is the canonical "AI tool reading patient data" flow:
//   1. AI tool requests Patient/<id>, Observation/<id>, Encounter/<id>
//   2. Vault contract layer tokenizes PHI before the resource hits the model
//   3. Audit-stream emits one event per access, hash-chained
//   4. Stream is verifiable end-to-end with the spec's own verifier
//
// In test-mode the FHIR client reads from fixtures/ for deterministic output.
// In live-mode it hits hapi.fhir.org/baseR4 (synthetic test data, no auth).

import { FhirClient } from "./fhir-client.mjs";
import { applyVaultContract } from "./vault.mjs";
import { EventBuilder } from "./event-builder.mjs";

const CANONICAL_DECISION_CARD = "https://stmary-hospital.example/.well-known/decisions/STMARY-DEC-2026-HEALTH-0042.json";
const CANONICAL_AI_TOOL_CARD  = "https://vendor-aiclinician.example/.well-known/ai-tool-cards/aiclinician-7.x.json";

// Canonical access plan: a 4-step trajectory simulating what an AI clinical-
// support tool does for a single patient encounter.
//
// In test-mode these IDs MUST exist in fixtures/. In live-mode they're real
// public HAPI FHIR test-server resource IDs (or you pass --patient-id to use
// a different one).
function defaultAccessPlan(patientId) {
  return [
    { step: 1, kind: "fhir.resource.read",   resourceType: "Patient",      id: patientId, purposeOfUse: "TREAT" },
    { step: 2, kind: "fhir.resource.search", resourceType: "Observation", params: { patient: patientId, _count: 5 }, purposeOfUse: "TREAT" },
    { step: 3, kind: "fhir.resource.search", resourceType: "Encounter",   params: { patient: patientId, _count: 3 }, purposeOfUse: "TREAT" },
    { step: 4, kind: "fhir.resource.search", resourceType: "Condition",   params: { patient: patientId, _count: 3 }, purposeOfUse: "TREAT" }
  ];
}

export async function runEndToEnd({
  mode = "live",
  baseUrl,
  fixturesDir,
  patientId = "example",   // HAPI's "Patient/example" canonical test patient
  source   = "rad-ai-chest-triage-prod",
  principal,
  fixedTimestamp,           // pass for deterministic test-mode output
  log = (..._args) => {}
} = {}) {
  const fhir = new FhirClient({ baseUrl, mode, fixturesDir });
  const builder = new EventBuilder({
    source,
    decisionCardRef: CANONICAL_DECISION_CARD,
    aiToolCardUrl: CANONICAL_AI_TOOL_CARD,
    principal,
    fixedTimestamp
  });

  const plan = defaultAccessPlan(patientId);
  const events = [];

  for (const step of plan) {
    log(`step ${step.step}: ${step.kind} ${step.resourceType}${step.id ? "/" + step.id : ""}`);

    let raw;
    if (step.kind === "fhir.resource.read") {
      raw = await fhir.read({ resourceType: step.resourceType, id: step.id });
    } else {
      raw = await fhir.search({ resourceType: step.resourceType, params: step.params });
    }

    // For a search bundle, walk each entry; for a single read, treat raw as the
    // resource itself.
    const accessed = raw.resourceType === "Bundle"
      ? (raw.entry || []).map((e) => e.resource).filter(Boolean)
      : [raw];

    for (const resource of accessed) {
      // Skip resources that have no derivable patient_ref (e.g. unrelated
      // resources HAPI sometimes includes).
      if (resource.resourceType !== "Patient" && !resource.subject?.reference?.startsWith("Patient/")) {
        log(`  skip ${resource.resourceType}/${resource.id} (no patient_ref)`);
        continue;
      }

      const { tokenizedResource, redactionApplied } = applyVaultContract(resource);
      const event = builder.buildEvent({
        kind: step.kind,
        fhirResource: resource,
        tokenizedResource,
        redactionApplied,
        purposeOfUse: step.purposeOfUse,
        outcome: "0",
        action: "R"
      });
      events.push(event);
      log(`  emitted event ${event.event_id} (${event.resource.type}/${event.resource.id}, ${redactionApplied.length} redactions)`);
    }
  }

  return events;
}

// Serialize events to NDJSON.
export function toNdjson(events) {
  return events.map((e) => JSON.stringify(e)).join("\n") + "\n";
}
