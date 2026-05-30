// cli.mjs — Command-line entry for fhir-audit-reference.
//
// Usage:
//   fhir-audit-reference --mode=test --output=examples/sample-output-stream.ndjson
//   fhir-audit-reference --mode=live --patient-id=example --output=stream.ndjson
//   fhir-audit-reference --mode=test --verify
//
// --mode=test reads fixtures/ (deterministic, no network — CI-safe)
// --mode=live hits hapi.fhir.org/baseR4 (synthetic public test data, no auth)
// --verify validates the produced stream against the spec schema + hash chain

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runEndToEnd, toNdjson } from "./orchestrator.mjs";
import { verifyStream } from "./verifier.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

function parseArgs(argv) {
  const args = { mode: "test", verify: true };
  for (const raw of argv.slice(2)) {
    if (!raw.startsWith("--")) continue;
    const [k, v] = raw.slice(2).split("=");
    if (v === undefined) args[k] = true;
    else args[k] = v;
  }
  return args;
}

export async function main(argv = process.argv) {
  const args = parseArgs(argv);
  const mode = args.mode || "test";
  const output = args.output ? resolve(process.cwd(), args.output) : null;

  const events = await runEndToEnd({
    mode,
    fixturesDir: resolve(REPO_ROOT, "fixtures"),
    patientId: args["patient-id"] || "example",
    source: args.source || "rad-ai-chest-triage-prod",
    // Deterministic timestamp in test-mode so the committed example output
    // is byte-stable across CI runs.
    fixedTimestamp: mode === "test" ? "2026-05-29T14:30:00.000Z" : null,
    log: (...m) => process.stderr.write(m.join(" ") + "\n")
  });

  const ndjson = toNdjson(events);

  if (output) {
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, ndjson, "utf8");
    process.stderr.write(`wrote ${events.length} events to ${output}\n`);
  } else {
    process.stdout.write(ndjson);
  }

  if (args.verify !== false && args.verify !== "false") {
    const result = await verifyStream(events);
    if (result.ok) {
      process.stderr.write(`verified ${events.length} events: schema=ok, chain=ok\n`);
      return 0;
    } else {
      process.stderr.write(`VERIFICATION FAILED:\n${result.errors.join("\n")}\n`);
      return 1;
    }
  }
  return 0;
}

// Direct execution: `node src/cli.mjs ...`
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("cli.mjs") || process.argv[1]?.endsWith("fhir-audit-reference")) {
  main().then((code) => process.exit(code)).catch((err) => {
    process.stderr.write(`ERROR: ${err.stack || err.message}\n`);
    process.exit(2);
  });
}
