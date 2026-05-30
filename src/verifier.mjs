// verifier.mjs — Verify a produced audit stream against:
//   1. The spec's JSON Schema (fetched/copied from kg-fhir-spec/schema/)
//   2. The hash chain (prev_hash + recomputed sha256 of canonical JSON)
//
// This is the "closing the loop" step: the same verifier logic the spec
// publishes is what we run on our own output. A green CI here is evidence
// the spec is implementable end-to-end, not just a JSON-Schema validator
// confirming our own emitter agrees with itself.

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const SCHEMA_PATH = resolve(REPO_ROOT, "schema/fhir-resource-access-event.schema.json");

const ZERO_HASH = "0".repeat(64);

function canonicalize(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalize).join(",") + "]";
  const keys = Object.keys(value).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalize(value[k])).join(",") + "}";
}

function sha256Hex(s) {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

let _validator = null;
function getValidator() {
  if (_validator) return _validator;
  const schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf8"));
  const ajv = new Ajv({ strict: false, allErrors: true });
  addFormats(ajv);
  _validator = ajv.compile(schema);
  return _validator;
}

export async function verifyStream(events) {
  const errors = [];
  const validate = getValidator();

  let prevHash = ZERO_HASH;
  events.forEach((event, idx) => {
    // 1. Schema
    if (!validate(event)) {
      for (const e of validate.errors || []) {
        errors.push(`event[${idx}] (${event.event_id}) schema: ${e.instancePath} ${e.message}`);
      }
    }

    // 2. prev_hash linkage
    if (event.prev_hash !== prevHash) {
      errors.push(`event[${idx}] (${event.event_id}) chain: prev_hash=${event.prev_hash} expected=${prevHash}`);
    }

    // 3. hash recomputation
    const { hash, ...rest } = event;
    const expected = sha256Hex(canonicalize(rest));
    if (hash !== expected) {
      errors.push(`event[${idx}] (${event.event_id}) chain: hash=${hash} recomputed=${expected}`);
    }

    prevHash = event.hash;
  });

  return { ok: errors.length === 0, errors, eventCount: events.length };
}
