import { Check } from "typebox/value";
import { describe, expect, it } from "vitest";
import {
  isLoomAssurance,
  LOOM_PROFILE_DESCRIPTORS,
  LoomAssuranceSchema,
  LoomProfileDescriptorSchema,
  RAW_PI_PROFILE,
  VEIL_PROFILE,
} from "../src/index.js";

describe("Loom profile protocol", () => {
  it("publishes exact Raw Pi and Veil capability descriptors", () => {
    expect(LOOM_PROFILE_DESCRIPTORS).toEqual([RAW_PI_PROFILE, VEIL_PROFILE]);
    expect(
      LOOM_PROFILE_DESCRIPTORS.every((profile) => Check(LoomProfileDescriptorSchema, profile)),
    ).toBe(true);
    expect(RAW_PI_PROFILE.capabilities).not.toContain("veil-promotion");
    expect(VEIL_PROFILE.capabilities).toContain("veil-reproduction");
  });

  it("rejects unknown profile fields", () => {
    expect(
      Check(LoomProfileDescriptorSchema, {
        ...RAW_PI_PROFILE,
        verified: true,
      }),
    ).toBe(false);
  });
});

describe("Loom assurance protocol", () => {
  it("allows Loom to issue only evidence-free exploratory assurance", () => {
    expect(
      isLoomAssurance({
        format: "loom.assurance.v0",
        state: "exploratory",
        issuer: "loom",
        evidenceRefs: [],
        limitations: ["Not independently verified"],
      }),
    ).toBe(true);
    expect(
      isLoomAssurance({
        format: "loom.assurance.v0",
        state: "accepted",
        issuer: "loom",
        evidenceRefs: [],
        limitations: [],
      }),
    ).toBe(false);
  });

  it("requires Veil evidence for every non-exploratory state", () => {
    expect(
      isLoomAssurance({
        format: "loom.assurance.v0",
        state: "accepted",
        issuer: "veil",
        evidenceRefs: ["veil-experiment:example"],
        limitations: [],
      }),
    ).toBe(true);
    expect(
      isLoomAssurance({
        format: "loom.assurance.v0",
        state: "rejected",
        issuer: "veil",
        evidenceRefs: [],
        limitations: [],
      }),
    ).toBe(false);
  });

  it("keeps structural schema validation separate from issuer semantics", () => {
    const forged = {
      format: "loom.assurance.v0",
      state: "accepted",
      issuer: "loom",
      evidenceRefs: [],
      limitations: [],
    };
    expect(Check(LoomAssuranceSchema, forged)).toBe(true);
    expect(isLoomAssurance(forged)).toBe(false);
  });
});
