import { Check } from "typebox/value";
import { describe, expect, it } from "vitest";
import {
  isLoomAcceptedCommandResponse,
  isLoomAssurance,
  isLoomAuthResponse,
  isLoomCancelTaskRequest,
  isLoomCreateSessionRequest,
  isLoomEventEnvelope,
  isLoomPiRuntimeDescriptor,
  isLoomPortableId,
  isLoomSendMessageRequest,
  LOOM_PROFILE_DESCRIPTORS,
  LoomAssuranceSchema,
  LoomEventEnvelopeSchema,
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

describe("Loom event protocol", () => {
  const event = {
    format: "loom.event.v0",
    eventId: "evt_00000000-0000-4000-8000-000000000001",
    projectId: "project-a",
    sessionId: "session-a",
    sequence: 1,
    occurredAt: "2026-08-17T10:00:00.000Z",
    type: "system.notice",
    payload: { message: "ready", progress: 0.5 },
  };

  it("accepts an exact, JSON-safe event envelope", () => {
    expect(Check(LoomEventEnvelopeSchema, event)).toBe(true);
    expect(isLoomEventEnvelope(event)).toBe(true);
  });

  it("rejects non-canonical time, non-finite payloads, and unknown fields", () => {
    expect(isLoomEventEnvelope({ ...event, occurredAt: "2026-08-17" })).toBe(false);
    expect(isLoomEventEnvelope({ ...event, payload: { metric: Number.NaN } })).toBe(false);
    expect(Check(LoomEventEnvelopeSchema, { ...event, verified: true })).toBe(false);
  });

  it("rejects cyclic payloads without throwing", () => {
    const payload: Record<string, unknown> = {};
    payload.self = payload;
    expect(() => isLoomEventEnvelope({ ...event, payload })).not.toThrow();
    expect(isLoomEventEnvelope({ ...event, payload })).toBe(false);
  });

  it("rejects identifiers that could become paths", () => {
    expect(isLoomEventEnvelope({ ...event, sessionId: "../session-a" })).toBe(false);
    expect(isLoomEventEnvelope({ ...event, projectId: "project/a" })).toBe(false);
    expect(isLoomPortableId("project-a_1.0")).toBe(true);
    expect(isLoomPortableId("../project-a")).toBe(false);
  });
});

describe("Loom authentication protocol", () => {
  it("acknowledges a bootstrap without exposing token material", () => {
    expect(isLoomAuthResponse({ format: "loom.auth.v0", status: "ready" })).toBe(true);
    expect(
      isLoomAuthResponse({ format: "loom.auth.v0", status: "ready", token: "must-not-leak" }),
    ).toBe(false);
  });
});

describe("Loom command protocol", () => {
  it("accepts exact create, message, cancel, and accepted-command records", () => {
    expect(
      isLoomCreateSessionRequest({
        format: "loom.session.create.v0",
        profile: "raw-pi",
        title: "Daily factor",
      }),
    ).toBe(true);
    expect(
      isLoomSendMessageRequest({ format: "loom.message.send.v0", content: "Inspect it." }),
    ).toBe(true);
    expect(isLoomCancelTaskRequest({ format: "loom.task.cancel.v0" })).toBe(true);
    expect(
      isLoomAcceptedCommandResponse({
        format: "loom.command.accepted.v0",
        commandId: "command-1",
        projectId: "project-1",
        sessionId: "session-1",
        taskId: "task-1",
      }),
    ).toBe(true);
  });

  it("rejects blank content, unknown fields, and non-portable response IDs", () => {
    expect(
      isLoomCreateSessionRequest({
        format: "loom.session.create.v0",
        profile: "raw-pi",
        title: "   ",
      }),
    ).toBe(false);
    expect(
      isLoomSendMessageRequest({
        format: "loom.message.send.v0",
        content: "   ",
        trusted: true,
      }),
    ).toBe(false);
    expect(
      isLoomAcceptedCommandResponse({
        format: "loom.command.accepted.v0",
        commandId: "../command",
        projectId: "project-1",
        sessionId: "session-1",
      }),
    ).toBe(false);
  });

  it("validates a redacted Pi runtime fingerprint without accepting extra details", () => {
    const runtime = {
      format: "loom.pi-runtime.v0",
      package: "@earendil-works/pi-coding-agent",
      version: "0.84.2",
      provider: "loom-offline-fixture",
      model: "loom-fixture-v0",
      mode: "offline-fixture",
      fingerprint: "pi-0.84.2__loom-offline-fixture__loom-fixture-v0",
    };
    expect(isLoomPiRuntimeDescriptor(runtime)).toBe(true);
    expect(isLoomPiRuntimeDescriptor({ ...runtime, apiKey: "must-not-leak" })).toBe(false);
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
