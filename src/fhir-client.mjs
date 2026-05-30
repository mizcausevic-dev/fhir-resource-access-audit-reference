// fhir-client.mjs — Thin FHIR R4 client for fetching public test data.
//
// Default base URL: https://hapi.fhir.org/baseR4 (HAPI FHIR public test
// server — no auth required, returns synthetic test data only).
//
// Test-mode (no network): returns deterministic fixtures from fixtures/.
//
// This is a reference-impl-grade client — minimal, no caching, no retries,
// no auth. A production impl would add SMART-on-FHIR OAuth, caching,
// circuit-breakers, etc. The point of THIS impl is to prove the audit-stream
// spec is implementable against real FHIR semantics, not to be a hardened
// FHIR client.

import { readFileSync } from "node:fs";
import { join } from "node:path";

const DEFAULT_BASE = "https://hapi.fhir.org/baseR4";

export class FhirClient {
  constructor({ baseUrl = DEFAULT_BASE, mode = "live", fixturesDir } = {}) {
    this.baseUrl = baseUrl;
    this.mode = mode;
    this.fixturesDir = fixturesDir;
  }

  async read({ resourceType, id }) {
    if (this.mode === "test") return this._loadFixture(`${resourceType}-${id}.json`);
    const url = `${this.baseUrl}/${resourceType}/${id}`;
    const res = await fetch(url, { headers: { "accept": "application/fhir+json" } });
    if (!res.ok) throw new Error(`FHIR read ${resourceType}/${id} failed: HTTP ${res.status}`);
    return await res.json();
  }

  async search({ resourceType, params }) {
    if (this.mode === "test") return this._loadFixture(`search-${resourceType}.json`);
    const query = new URLSearchParams(params).toString();
    const url = `${this.baseUrl}/${resourceType}?${query}`;
    const res = await fetch(url, { headers: { "accept": "application/fhir+json" } });
    if (!res.ok) throw new Error(`FHIR search ${resourceType} failed: HTTP ${res.status}`);
    return await res.json();
  }

  _loadFixture(name) {
    if (!this.fixturesDir) throw new Error("test mode requires fixturesDir");
    return JSON.parse(readFileSync(join(this.fixturesDir, name), "utf8"));
  }
}
