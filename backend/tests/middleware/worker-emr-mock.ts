/** Stateful HTTP contract fake, NOT an implementation or acceptance test of real EMR. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as pause } from "node:timers/promises";
import express from "express";
import { canonicalJson } from "../../src/middleware/canonical-json.js";
import type { FhirR4LabObservation } from "../../src/middleware/mapper.js";
import { startHttpServer } from "./http-test-helpers.js";

export function labItem(observation: FhirR4LabObservation, patientKey: string = randomUUID(), targetId: string = randomUUID()) {
  return {
    target_id: targetId, patient_key: patientKey,
    external_system: observation.identifier[0].system, external_id: observation.identifier[0].value,
    analyte_system: observation.code.coding[0].system, analyte_code: observation.code.coding[0].code,
    analyte_display: observation.code.coding[0].display, analyte_context: observation.code.text,
    quantity: String(observation.valueQuantity.value), unit_text: observation.valueQuantity.unit,
    low: observation.referenceRange?.[0].low === undefined ? null : String(observation.referenceRange[0].low.value),
    high: observation.referenceRange?.[0].high === undefined ? null : String(observation.referenceRange[0].high.value),
    effective_at: observation.effectiveDateTime, clinical_status: observation.status, fhir_json: structuredClone(observation),
  };
}
export type MockLabItem = ReturnType<typeof labItem>;
interface Plan {
  status?: number;
  delayMs?: number;
  hold?: Promise<void>;
  transform?: (body: Record<string, unknown>) => unknown;
  raw?: string;
  contentType?: string;
  disconnect?: boolean;
  stallBodyMs?: number;
}
export async function startContractEmr(expected: FhirR4LabObservation, options: { patientLinked?: boolean } = {}) {
  const patientKey = randomUUID();
  const records = new Map<string, MockLabItem>();
  const postPlans: Plan[] = []; const getPlans: Plan[] = [];
  const requests: { method: string; body?: string; system?: string; id?: string }[] = [];
  const violations: string[] = [];
  const app = express();
  app.use(express.json({ type: "application/fhir+json", limit: "1mb" }));
  app.post("/api/observations", async (req, res) => {
    requests.push({ method: "POST", body: canonicalJson(req.body) });
    try {
      assert.equal(req.get("content-type"), "application/fhir+json");
      assert.deepEqual(Object.keys(req.query), []);
      // The contract fixture checks every emitted FHIR field before storage.
      assert.deepEqual(req.body, expected);
    } catch {
      violations.push("POST contract mismatch"); res.status(422).json({ error: { code: "VALIDATION_ERROR" } }); return;
    }
    const plan = postPlans.shift();
    if (plan?.status && plan.status !== 200 && plan.status !== 201) {
      res.status(plan.status).json({ error: { code: "DEPENDENCY_UNAVAILABLE", message: "private diagnostic must not be stored" } }); return;
    }
    if (options.patientLinked === false) { res.status(422).json({ error: { code: "PATIENT_NOT_LINKED" } }); return; }
    const key = `${expected.identifier[0].system}|${expected.identifier[0].value}`;
    const existing = records.get(key);
    if (existing && canonicalJson(existing.fhir_json) !== canonicalJson(req.body)) {
      res.status(409).json({ error: { code: "DUPLICATE_CONFLICT" } }); return;
    }
    const item = existing ?? labItem(expected, patientKey);
    records.set(key, item); // Delayed response can time out AFTER a durable mock store.
    if (plan?.disconnect) { req.socket.destroy(); return; }
    if (plan?.hold) await plan.hold;
    if (plan?.delayMs) await pause(plan.delayMs);
    const body = { result: existing ? "ALREADY_EXISTS" : "STORED", external_system: item.external_system,
      external_id: item.external_id, target_id: item.target_id, patient_key: item.patient_key };
    res.status(plan?.status ?? (existing ? 200 : 201));
    if (plan?.stallBodyMs) {
      res.type("application/json"); res.write('{"result":');
      await pause(plan.stallBodyMs); res.end('"STORED"}');
    } else if (plan?.raw !== undefined) res.type(plan.contentType ?? "application/json").send(plan.raw);
    else res.json(plan?.transform ? plan.transform(body) : body);
  });
  app.get("/api/lab-results", async (req, res) => {
    requests.push({ method: "GET", system: String(req.query.external_system), id: String(req.query.external_id) });
    if (Object.keys(req.query).sort().join() !== "external_id,external_system"
      || req.query.external_system !== expected.identifier[0].system || req.query.external_id !== expected.identifier[0].value) {
      violations.push("GET contract mismatch"); res.status(400).json({ error: { code: "VALIDATION_ERROR" } }); return;
    }
    const plan = getPlans.shift();
    if (plan?.hold) await plan.hold;
    if (plan?.delayMs) await pause(plan.delayMs);
    if (plan?.status && plan.status !== 200) { res.status(plan.status).json({ error: { code: "DEPENDENCY_UNAVAILABLE" } }); return; }
    const items = [...records.values()].filter((item) => item.external_system === req.query.external_system && item.external_id === req.query.external_id);
    const body = { items: structuredClone(items) };
    if (plan?.raw !== undefined) res.type(plan.contentType ?? "application/json").send(plan.raw);
    else res.json(plan?.transform ? plan.transform(body) : body);
  });
  const server = await startHttpServer(app);
  return { ...server, patientKey, records, requests, postPlans, getPlans, violations,
    seed(observation = expected) {
      const item = labItem(observation, patientKey);
      records.set(`${item.external_system}|${item.external_id}`, item); return item;
    } };
}
