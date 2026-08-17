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

export const LoomCapabilitiesResponseSchema = Type.Object(
  {
    format: Type.Literal("loom.capabilities.v0"),
    profiles: Type.Array(LoomProfileDescriptorSchema, { minItems: 1 }),
  },
  { additionalProperties: false, $id: "LoomCapabilitiesResponse" },
);

export type LoomCapabilitiesResponse = Static<typeof LoomCapabilitiesResponseSchema>;
