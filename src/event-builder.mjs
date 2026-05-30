// event-builder.mjs — Build hash-chained Suite-compliant FHIR audit events
// from a sequence of FHIR resource accesses.
//
// Schema: https://github.com/mizcausevic-dev/fhir-resource-access-audit
// (event_id + timestamp + kind + source + patient_ref + resource + action +
// outcome + agent + decision_card_ref + prev_hash + hash, plus optional
// purpose_of_use + network + redaction_applied + signature).

import { createHash, randomUUID } from "node:crypto";

const ZERO_HASH = "0".repeat(64);

// Deterministic canonical JSON: keys sorted lexicographically, no insignificant
// whitespace. Matches the canonicalization used by the spec's verifier.
function canonicalize(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalize).join(",") + "]";
  const keys = Object.keys(value).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalize(value[k])).join(",") + "}";
}

function sha256Hex(s) {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

// Extract a FHIR patient_ref from a fetched resource. For Patient itself it's
// just `Patient/<id>`. For other resources (Observation, Encounter, etc.) it
// pulls from resource.subject.reference.
export function patientRefFor(resource) {
  if (resource.resourceType === "Patient") return `Patient/${resource.id}`;
  if (resource.subject?.reference?.startsWith("Patient/")) return resource.subject.reference;
  if (resource.patient?.reference?.startsWith("Patient/")) return resource.patient.reference;
  return null;
}

// EventBuilder — accumulates a hash chain, one event per access.
export class EventBuilder {
  constructor({ source, decisionCardRef, aiToolCardUrl, principal, fixedTimestamp } = {}) {
    if (!source) throw new Error("source required");
    if (!decisionCardRef) throw new Error("decisionCardRef required");
    if (!aiToolCardUrl) throw new Error("aiToolCardUrl required");
    this.source = source;
    this.decisionCardRef = decisionCardRef;
    this.aiToolCardUrl = aiToolCardUrl;
    this.principal = principal;
    this.fixedTimestamp = fixedTimestamp || null;  // for deterministic test-mode
    this.prevHash = ZERO_HASH;
    this.counter = 0;
  }

  buildEvent({ kind, fhirResource, tokenizedResource, redactionApplied, purposeOfUse, outcome = "0", action = "R" }) {
    this.counter += 1;

    const patientRef = patientRefFor(tokenizedResource);
    if (!patientRef) throw new Error(`patient_ref could not be derived for ${tokenizedResource.resourceType}/${tokenizedResource.id}`);

    // Use the tokenized resource id (which may still be the FHIR-server id if
    // not tokenized; the canonical example tokenizes Patient.identifier not
    // Patient.id since FHIR ids are not PHI under HIPAA Safe Harbor).
    const event = {
      event_id: this.fixedTimestamp ? `0190fhir-${this.counter.toString().padStart(4, "0")}` : randomUUID(),
      timestamp: this.fixedTimestamp || new Date().toISOString(),
      kind,
      source: this.source,
      patient_ref: patientRef,
      resource: {
        type: tokenizedResource.resourceType,
        id: tokenizedResource.id
      },
      action,
      outcome,
      agent: {
        ai_tool_card_url: this.aiToolCardUrl,
        ai_decision_card_url: this.decisionCardRef
      },
      decision_card_ref: this.decisionCardRef,
      prev_hash: this.prevHash
    };

    if (this.principal) event.agent.principal = this.principal;
    if (tokenizedResource.meta?.versionId) event.resource.version_id = tokenizedResource.meta.versionId;
    if (purposeOfUse) event.purpose_of_use = purposeOfUse;
    // Always emit redaction_applied (even when empty) so an auditor can tell
    // "vault contract was applied and matched nothing" apart from "vault
    // contract was not applied at all". Spec allows both shapes; this
    // reference implementation picks the explicit one.
    event.redaction_applied = Array.isArray(redactionApplied) ? redactionApplied : [];

    // Hash chain: hash = sha256(canonical_json(event - {hash})), excluding the
    // hash field itself. prev_hash already populated above.
    event.hash = sha256Hex(canonicalize(event));
    this.prevHash = event.hash;

    return event;
  }
}
