/** Stable project identifiers, independent of HTTP deployment addresses. */
export const FHIR_NAMESPACES = Object.freeze({
  result: "urn:uuid:05934370-0df0-5666-8eff-bd5181906b62",
  patient: "urn:uuid:b954f2c4-cfe0-575f-86c0-c1cba88052a4",
  test: "urn:uuid:cb8ffc71-ef38-58d2-ba65-0bf0232d5d02",
  category: "http://terminology.hl7.org/CodeSystem/observation-category",
} as const);
