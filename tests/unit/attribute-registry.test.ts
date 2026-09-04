import { describe, expect, it } from "vitest";
import {
  assertRegisteredAttributeKey,
  getAttributeDefinition,
  rejectClientAuthorityFields,
  validateAttributeValue,
  ATTRIBUTE_REGISTRY,
} from "@/lib/student/attribute-registry";
import { ValidationError } from "@/lib/errors";
import {
  mayOverwriteCurrentState,
  defaultConfidenceFor,
} from "@/lib/provenance/policy";

describe("attribute registry", () => {
  it("accepts registered keys from the starter set", () => {
    expect(getAttributeDefinition("academic.level")).toBeDefined();
    expect(assertRegisteredAttributeKey("pref.explanation_length").key).toBe(
      "pref.explanation_length",
    );
    expect(Object.keys(ATTRIBUTE_REGISTRY).length).toBeGreaterThanOrEqual(8);
    expect(Object.keys(ATTRIBUTE_REGISTRY).length).toBeLessThanOrEqual(20);
  });

  it("rejects unknown attribute keys", () => {
    expect(() => assertRegisteredAttributeKey("learning.style.vak")).toThrow(
      ValidationError,
    );
    expect(() => assertRegisteredAttributeKey("arbitrary.foo")).toThrow(
      ValidationError,
    );
  });

  it("rejects invalid values for registered keys", () => {
    const level = assertRegisteredAttributeKey("academic.level");
    expect(() => validateAttributeValue(level, "phd-wizard")).toThrow(
      ValidationError,
    );
    expect(validateAttributeValue(level, "undergrad")).toBe("undergrad");

    const subjects = assertRegisteredAttributeKey("academic.subjects");
    expect(() => validateAttributeValue(subjects, "math")).toThrow(
      ValidationError,
    );
    expect(() =>
      validateAttributeValue(subjects, Array.from({ length: 20 }, (_, i) => `s${i}`)),
    ).toThrow(ValidationError);
  });

  it("rejects client-supplied provenance/confidence/source", () => {
    expect(() =>
      rejectClientAuthorityFields({
        key: "academic.level",
        value: "hs",
        provenance: "EXPLICIT",
      }),
    ).toThrow(ValidationError);

    expect(() =>
      rejectClientAuthorityFields({
        key: "academic.level",
        value: "hs",
        confidence: 1,
      }),
    ).toThrow(ValidationError);

    expect(() =>
      rejectClientAuthorityFields({
        key: "academic.level",
        value: "hs",
        source: "hacker",
      }),
    ).toThrow(ValidationError);
  });
});

describe("provenance precedence", () => {
  it("allows EXPLICIT to overwrite anything", () => {
    expect(
      mayOverwriteCurrentState({
        existingProvenance: "INFERRED",
        existingConfidence: 0.9,
        incomingProvenance: "EXPLICIT",
      }),
    ).toBe(true);
  });

  it("blocks OBSERVED/INFERRED from overwriting EXPLICIT even with higher confidence numbers", () => {
    expect(
      mayOverwriteCurrentState({
        existingProvenance: "EXPLICIT",
        existingConfidence: 0.5,
        incomingProvenance: "OBSERVED",
      }),
    ).toBe(false);
    expect(
      mayOverwriteCurrentState({
        existingProvenance: "EXPLICIT",
        existingConfidence: 0.5,
        incomingProvenance: "INFERRED",
      }),
    ).toBe(false);
  });

  it("defines confidence as bounded reliability defaults", () => {
    expect(defaultConfidenceFor("EXPLICIT")).toBeGreaterThan(0.8);
    expect(defaultConfidenceFor("INFERRED")).toBeLessThanOrEqual(0.5);
    expect(defaultConfidenceFor("HYPOTHESIS")).toBeLessThanOrEqual(0.3);
  });
});
