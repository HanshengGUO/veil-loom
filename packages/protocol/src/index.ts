import { type Static, Type } from "typebox";
import { Check } from "typebox/value";

export const LOOM_PROTOCOL_VERSION = "0" as const;

export const LoomSessionProfileSchema = Type.Union([Type.Literal("raw-pi"), Type.Literal("veil")], {
  $id: "LoomSessionProfile",
});

export type LoomSessionProfile = Static<typeof LoomSessionProfileSchema>;

export const LoomCapabilitySchema = Type.Union(
  [
    Type.Literal("chat"),
    Type.Literal("local-code"),
    Type.Literal("loom-chart"),
    Type.Literal("loom-selection"),
    Type.Literal("task-cancel"),
    Type.Literal("session-replay"),
    Type.Literal("veil-data"),
    Type.Literal("veil-promotion"),
    Type.Literal("veil-experiment"),
    Type.Literal("veil-reproduction"),
  ],
  { $id: "LoomCapability" },
);

export type LoomCapability = Static<typeof LoomCapabilitySchema>;

export const LoomProfileDescriptorSchema = Type.Object(
  {
    id: LoomSessionProfileSchema,
    label: Type.String({ minLength: 1 }),
    assurance: Type.Union([
      Type.Literal("exploration-only"),
      Type.Literal("veil-verification-available"),
    ]),
    capabilities: Type.Array(LoomCapabilitySchema, { minItems: 1, uniqueItems: true }),
  },
  { additionalProperties: false, $id: "LoomProfileDescriptor" },
);

export type LoomProfileDescriptor = Static<typeof LoomProfileDescriptorSchema>;

const SHARED_CAPABILITIES = [
  "chat",
  "local-code",
  "loom-chart",
  "loom-selection",
  "task-cancel",
  "session-replay",
] as const satisfies readonly LoomCapability[];

export const RAW_PI_PROFILE: LoomProfileDescriptor = {
  id: "raw-pi",
  label: "Raw Pi",
  assurance: "exploration-only",
  capabilities: [...SHARED_CAPABILITIES],
};

export const VEIL_PROFILE: LoomProfileDescriptor = {
  id: "veil",
  label: "Veil",
  assurance: "veil-verification-available",
  capabilities: [
    ...SHARED_CAPABILITIES,
    "veil-data",
    "veil-promotion",
    "veil-experiment",
    "veil-reproduction",
  ],
};

export const LOOM_PROFILE_DESCRIPTORS: LoomProfileDescriptor[] = [RAW_PI_PROFILE, VEIL_PROFILE];

export const LoomAssuranceStateSchema = Type.Union(
  [
    Type.Literal("exploratory"),
    Type.Literal("contract-verified-unverified"),
    Type.Literal("accepted"),
    Type.Literal("degraded"),
    Type.Literal("rejected"),
  ],
  { $id: "LoomAssuranceState" },
);

export type LoomAssuranceState = Static<typeof LoomAssuranceStateSchema>;

export const LoomAssuranceSchema = Type.Object(
  {
    format: Type.Literal("loom.assurance.v0"),
    state: LoomAssuranceStateSchema,
    issuer: Type.Union([Type.Literal("loom"), Type.Literal("veil")]),
    evidenceRefs: Type.Array(Type.String({ minLength: 1 }), { uniqueItems: true }),
    limitations: Type.Array(Type.String({ minLength: 1 })),
  },
  { additionalProperties: false, $id: "LoomAssurance" },
);

export type LoomAssurance = Static<typeof LoomAssuranceSchema>;

export function isLoomAssurance(input: unknown): input is LoomAssurance {
  if (!Check(LoomAssuranceSchema, input)) return false;
  if (input.state === "exploratory") {
    return input.issuer === "loom" && input.evidenceRefs.length === 0;
  }
  return input.issuer === "veil" && input.evidenceRefs.length > 0;
}

export const LoomHealthResponseSchema = Type.Object(
  {
    format: Type.Literal("loom.health.v0"),
    service: Type.Literal("veil-loom-daemon"),
    status: Type.Literal("ok"),
    version: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false, $id: "LoomHealthResponse" },
);

export type LoomHealthResponse = Static<typeof LoomHealthResponseSchema>;

export const LoomAuthResponseSchema = Type.Object(
  {
    format: Type.Literal("loom.auth.v0"),
    status: Type.Literal("ready"),
  },
  { additionalProperties: false, $id: "LoomAuthResponse" },
);

export type LoomAuthResponse = Static<typeof LoomAuthResponseSchema>;

export function isLoomAuthResponse(input: unknown): input is LoomAuthResponse {
  return Check(LoomAuthResponseSchema, input);
}

export const LoomCapabilitiesResponseSchema = Type.Object(
  {
    format: Type.Literal("loom.capabilities.v0"),
    profiles: Type.Array(LoomProfileDescriptorSchema, { minItems: 1 }),
  },
  { additionalProperties: false, $id: "LoomCapabilitiesResponse" },
);

export type LoomCapabilitiesResponse = Static<typeof LoomCapabilitiesResponseSchema>;

const PORTABLE_ID_PATTERN = "^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$";
const PORTABLE_ID_REGEXP = new RegExp(PORTABLE_ID_PATTERN);

export const LoomPortableIdSchema = Type.String({
  pattern: PORTABLE_ID_PATTERN,
  $id: "LoomPortableId",
});

export type LoomPortableId = Static<typeof LoomPortableIdSchema>;

export function isLoomPortableId(input: unknown): input is LoomPortableId {
  return typeof input === "string" && PORTABLE_ID_REGEXP.test(input);
}

export const LoomEventTypeSchema = Type.Union(
  [
    Type.Literal("session.created"),
    Type.Literal("session.ready"),
    Type.Literal("session.status_changed"),
    Type.Literal("message.user_appended"),
    Type.Literal("message.assistant_delta"),
    Type.Literal("message.assistant_completed"),
    Type.Literal("tool.started"),
    Type.Literal("tool.progress"),
    Type.Literal("tool.completed"),
    Type.Literal("tool.failed"),
    Type.Literal("task.started"),
    Type.Literal("task.cancel_requested"),
    Type.Literal("task.cancelled"),
    Type.Literal("task.completed"),
    Type.Literal("task.failed"),
    Type.Literal("view.published"),
    Type.Literal("view.superseded"),
    Type.Literal("selection.created"),
    Type.Literal("veil.verification_started"),
    Type.Literal("veil.stage_changed"),
    Type.Literal("veil.experiment_recorded"),
    Type.Literal("veil.reproduction_completed"),
    Type.Literal("system.notice"),
  ],
  { $id: "LoomEventType" },
);

export type LoomEventType = Static<typeof LoomEventTypeSchema>;

export const LoomEventPayloadSchema = Type.Record(Type.String(), Type.Unknown(), {
  $id: "LoomEventPayload",
});

export type LoomEventPayload = Static<typeof LoomEventPayloadSchema>;

export const LoomEventEnvelopeSchema = Type.Object(
  {
    format: Type.Literal("loom.event.v0"),
    eventId: LoomPortableIdSchema,
    projectId: LoomPortableIdSchema,
    sessionId: LoomPortableIdSchema,
    sequence: Type.Integer({ minimum: 1 }),
    occurredAt: Type.String({ minLength: 1 }),
    type: LoomEventTypeSchema,
    payload: LoomEventPayloadSchema,
  },
  { additionalProperties: false, $id: "LoomEventEnvelope" },
);

export type LoomEventEnvelope = Static<typeof LoomEventEnvelopeSchema>;

export function isLoomEventEnvelope(input: unknown): input is LoomEventEnvelope {
  try {
    if (!Check(LoomEventEnvelopeSchema, input)) return false;
    return isCanonicalIsoTime(input.occurredAt) && isJsonRecord(input.payload);
  } catch {
    return false;
  }
}

export const LoomEventsResponseSchema = Type.Object(
  {
    format: Type.Literal("loom.events.v0"),
    events: Type.Array(LoomEventEnvelopeSchema),
  },
  { additionalProperties: false, $id: "LoomEventsResponse" },
);

export type LoomEventsResponse = Static<typeof LoomEventsResponseSchema>;

export const LoomErrorCodeSchema = Type.Union(
  [
    Type.Literal("INVALID_REQUEST"),
    Type.Literal("EVENT_CURSOR_AHEAD"),
    Type.Literal("EVENT_LOG_UNAVAILABLE"),
    Type.Literal("AUTH_REQUIRED"),
    Type.Literal("ORIGIN_FORBIDDEN"),
    Type.Literal("INTERNAL_ERROR"),
  ],
  { $id: "LoomErrorCode" },
);

export type LoomErrorCode = Static<typeof LoomErrorCodeSchema>;

export const LoomErrorResponseSchema = Type.Object(
  {
    format: Type.Literal("loom.error.v0"),
    code: LoomErrorCodeSchema,
    message: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false, $id: "LoomErrorResponse" },
);

export type LoomErrorResponse = Static<typeof LoomErrorResponseSchema>;

function isCanonicalIsoTime(input: string): boolean {
  const milliseconds = Date.parse(input);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === input;
}

function isJsonRecord(input: unknown): input is Record<string, unknown> {
  return isJsonValue(input, new WeakSet()) && input !== null && !Array.isArray(input);
}

function isJsonValue(input: unknown, ancestors: WeakSet<object>): boolean {
  if (input === null || typeof input === "string" || typeof input === "boolean") return true;
  if (typeof input === "number") return Number.isFinite(input);
  if (typeof input !== "object") return false;
  if (ancestors.has(input)) return false;
  ancestors.add(input);
  try {
    if (Array.isArray(input)) return input.every((value) => isJsonValue(value, ancestors));
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null) return false;
    return Object.values(input).every((value) => isJsonValue(value, ancestors));
  } finally {
    ancestors.delete(input);
  }
}
