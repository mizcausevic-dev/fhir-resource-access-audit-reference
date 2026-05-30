// vault.mjs — Apply the Decision Card vault contract to a FHIR resource.
//
// Walks the resource and:
//   1. Tokenizes named fields (PHI -> opaque token)
//   2. Records each transformation as a redaction_applied entry
//   3. Returns the tokenized resource + the redaction-applied list
//
// This is the buyer-side enforcement of the vault contract — the AI tool
// receives the tokenized resource, the audit event records what was tokenized.
//
// The transformation rules below match the phi-vault-contract-profile
// canonical Decision Card (HIPAA 18 Safe Harbor identifier categories).

import { createHash } from "node:crypto";

// HIPAA Safe Harbor field paths that we tokenize in this reference impl.
// Real impl would consume the buyer's actual Decision Card vault contract
// JSON and walk its data_category_access list. This is the canonical example
// for the FHIR Patient resource shape.
const VAULT_RULES = [
  { path: "Patient.name",                            action: "tokenize" },
  { path: "Patient.identifier",                      action: "tokenize" },
  { path: "Patient.telecom",                         action: "mask"     },
  { path: "Patient.address",                         action: "tokenize" },
  { path: "Patient.birthDate",                       action: "hash"     },
  { path: "Patient.contact",                         action: "drop"     },
  { path: "Observation.subject.display",             action: "drop"     },
  { path: "Encounter.subject.display",               action: "drop"     },
  { path: "Encounter.participant.individual.display","action": "drop"  }
];

function tokenize(value) {
  if (value === undefined || value === null) return value;
  // Stable token derived from deterministic hash of the canonical-JSON of the value.
  // A real impl would call the buyer's vault service (Skyflow, Privacera, etc.)
  // and return the vault-issued token; this is a deterministic stand-in for the
  // reference-impl test demonstration.
  const json = JSON.stringify(value);
  const hash = createHash("sha256").update(json, "utf8").digest("hex").slice(0, 12);
  return `tok_${hash}`;
}

function maskString(s) {
  if (typeof s !== "string" || s.length <= 4) return "***";
  return s.slice(0, 2) + "***" + s.slice(-2);
}

function hashValue(value) {
  if (value === undefined || value === null) return value;
  const json = JSON.stringify(value);
  return "hash_" + createHash("sha256").update(json, "utf8").digest("hex").slice(0, 16);
}

// Apply a single rule to a FHIR resource. Returns { applied: boolean }.
function applyRule(resource, rule) {
  const [resourceType, ...rest] = rule.path.split(".");
  if (resource.resourceType !== resourceType) return { applied: false };
  if (rest.length === 0) return { applied: false };

  // Walk down the path. We only handle the top-level field for this reference
  // impl; nested-path tokenization would walk deeper but the SHAPE is the same.
  const topField = rest[0];
  if (resource[topField] === undefined) return { applied: false };

  switch (rule.action) {
    case "tokenize":
      resource[topField] = Array.isArray(resource[topField])
        ? resource[topField].map(tokenize)
        : tokenize(resource[topField]);
      return { applied: true };
    case "mask":
      resource[topField] = Array.isArray(resource[topField])
        ? resource[topField].map((v) => ({ ...v, value: maskString(v.value) }))
        : maskString(resource[topField]);
      return { applied: true };
    case "hash":
      resource[topField] = hashValue(resource[topField]);
      return { applied: true };
    case "drop":
      // For nested paths like Observation.subject.display, walk down + delete the leaf.
      if (rest.length === 1) {
        delete resource[topField];
      } else {
        const parent = rest.slice(0, -1).reduce((acc, k) => acc?.[k], resource);
        if (parent && typeof parent === "object") delete parent[rest[rest.length - 1]];
      }
      return { applied: true };
    default:
      return { applied: false };
  }
}

// applyVaultContract: tokenize a FHIR resource per the vault contract.
// Returns { tokenizedResource, redactionApplied }.
export function applyVaultContract(rawResource) {
  // Deep clone so we don't mutate the caller's resource
  const resource = JSON.parse(JSON.stringify(rawResource));
  const redactionApplied = [];

  for (const rule of VAULT_RULES) {
    const { applied } = applyRule(resource, rule);
    if (applied) {
      redactionApplied.push({ field: rule.path, action: rule.action });
    }
  }

  return { tokenizedResource: resource, redactionApplied };
}
