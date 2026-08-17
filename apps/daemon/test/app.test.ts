import { LoomCapabilitiesResponseSchema, LoomHealthResponseSchema } from "@veilquant/loom-protocol";
import { Check } from "typebox/value";
import { describe, expect, it } from "vitest";
import { createLoomApp } from "../src/app.js";

describe("Loom daemon scaffold", () => {
  it("returns a versioned health response without local details", async () => {
    const response = await createLoomApp().request("/v0/health");
    const body: unknown = await response.json();

    expect(response.status).toBe(200);
    expect(Check(LoomHealthResponseSchema, body)).toBe(true);
    expect(JSON.stringify(body)).not.toContain("/home/");
  });

  it("discovers Raw Pi and Veil profiles through the shared protocol", async () => {
    const response = await createLoomApp().request("/v0/capabilities");
    const body: unknown = await response.json();

    expect(response.status).toBe(200);
    expect(Check(LoomCapabilitiesResponseSchema, body)).toBe(true);
    expect(body).toMatchObject({
      profiles: [{ id: "raw-pi" }, { id: "veil" }],
    });
  });
});
