import { describe, expect, it } from "vitest";
import { createEnvelope } from "../envelope";
import {
  EXTERNAL_CONTROL_PROTOCOL_VERSION,
  EXTERNAL_CONTROL_TOOLS,
  ExternalControlCallEnvelopeSchema,
  ExternalControlHelloEnvelopeSchema,
  ExternalControlResultSchema,
  ExternalControlStateFileSchema,
  GetAppStatusInputSchema,
  externalControlToolInputJsonSchema,
  findExternalControlTool
} from "./index";

describe("external control tools", () => {
  it("lists uniquely named tools with flat object schemas", () => {
    const names = EXTERNAL_CONTROL_TOOLS.map((tool) => tool.name);
    expect(new Set(names).size).toBe(names.length);
    for (const tool of EXTERNAL_CONTROL_TOOLS) {
      expect(tool.name).toMatch(/^[a-z][a-z_]*$/u);
      const schema = externalControlToolInputJsonSchema(tool);
      expect(schema.type).toBe("object");
      expect(schema).not.toHaveProperty("$schema");
      // Several MCP clients reject top-level unions in tool schemas.
      expect(schema).not.toHaveProperty("oneOf");
      expect(schema).not.toHaveProperty("anyOf");
    }
  });

  it("marks nothing destructive, which Codex would refuse outright", () => {
    for (const tool of EXTERNAL_CONTROL_TOOLS) {
      expect(tool.annotations.destructiveHint).toBe(false);
    }
  });

  it("finds tools by exact name only", () => {
    expect(findExternalControlTool("get_app_status")?.name).toBe(
      "get_app_status"
    );
    expect(findExternalControlTool("GET_APP_STATUS")).toBeUndefined();
    expect(findExternalControlTool("catalog.saveDocument")).toBeUndefined();
  });

  it("rejects unexpected status arguments", () => {
    expect(GetAppStatusInputSchema.safeParse({}).success).toBe(true);
    expect(GetAppStatusInputSchema.safeParse({ path: "/" }).success).toBe(
      false
    );
  });
});

describe("external control protocol", () => {
  const ready = {
    status: "ready",
    protocolVersion: EXTERNAL_CONTROL_PROTOCOL_VERSION,
    appVersion: "1.0.0",
    pid: 42,
    endpoint: "/tmp/example.sock",
    token: "0".repeat(64),
    startedAt: "2026-10-31T00:00:00.000Z"
  };

  it("keeps connection details out of the disabled state", () => {
    expect(ExternalControlStateFileSchema.parse(ready).status).toBe("ready");
    const disabled = ExternalControlStateFileSchema.parse({
      status: "disabled",
      protocolVersion: EXTERNAL_CONTROL_PROTOCOL_VERSION,
      appVersion: "1.0.0",
      pid: 42
    });
    expect(disabled).not.toHaveProperty("token");
    expect(disabled).not.toHaveProperty("endpoint");
  });

  it("rejects a ready state without a usable token", () => {
    expect(
      ExternalControlStateFileSchema.safeParse({ ...ready, token: "short" })
        .success
    ).toBe(false);
  });

  it("validates hello and call envelopes", () => {
    const hello = createEnvelope(
      "externalControl.hello",
      {
        protocolVersion: EXTERNAL_CONTROL_PROTOCOL_VERSION,
        token: "invalid-test-token",
        client: { name: "test-client" }
      },
      { id: "hello-1" }
    );
    expect(ExternalControlHelloEnvelopeSchema.safeParse(hello).success).toBe(
      true
    );
    const call = createEnvelope(
      "externalControl.call",
      { tool: "get_app_status", arguments: {} },
      { id: "call-1" }
    );
    expect(ExternalControlCallEnvelopeSchema.safeParse(call).success).toBe(
      true
    );
    expect(
      ExternalControlCallEnvelopeSchema.safeParse({
        ...call,
        payload: { tool: "get_app_status", arguments: [] }
      }).success
    ).toBe(false);
  });

  it("only accepts known error codes", () => {
    expect(
      ExternalControlResultSchema.safeParse({
        status: "rejected",
        requestId: "call-1",
        error: { code: "external.disabled", message: "off" }
      }).success
    ).toBe(true);
    expect(
      ExternalControlResultSchema.safeParse({
        status: "rejected",
        requestId: "call-1",
        error: { code: "catalog.conflict", message: "no" }
      }).success
    ).toBe(false);
  });
});
