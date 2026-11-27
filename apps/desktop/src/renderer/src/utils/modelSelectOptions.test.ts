import { describe, expect, it } from "vitest";
import { buildModelSelectOptions } from "./modelSelectOptions";

describe("buildModelSelectOptions", () => {
  it("groups official, custom providers, and free models while forwarding provider and modelId", () => {
    const options = buildModelSelectOptions([
      {
        id: "free-1",
        label: "Free Flash",
        provider: "deepwrite-free",
        modelId: "deepseek-flash",
        managedBy: "deepwrite-free"
      },
      {
        id: "custom-1",
        label: "My DeepSeek",
        provider: "deepseek",
        modelId: "deepseek-chat"
      },
      {
        id: "deepwrite-site-official-claude",
        label: "Claude Opus 5.5",
        provider: "deepwrite-site",
        modelId: "claude-opus-5-5"
      },
      {
        id: "custom-2",
        label: "Private Proxy",
        provider: "my-proxy"
      }
    ]);

    expect(options.map((option) => option.value)).toEqual([
      "deepwrite-site-official-claude",
      "custom-1",
      "custom-2",
      "free-1"
    ]);
    expect(options[0]).toMatchObject({
      provider: "deepwrite-site",
      modelId: "claude-opus-5-5",
      group: { key: "official" }
    });
    expect(options[1]).toMatchObject({
      provider: "deepseek",
      modelId: "deepseek-chat",
      group: { key: "custom:deepseek", label: "DeepSeek" }
    });
    expect(options[2]).toMatchObject({
      provider: "my-proxy",
      group: { key: "custom:my-proxy", label: "my-proxy" }
    });
    expect(options[2]).not.toHaveProperty("modelId");
    expect(options[3]).toMatchObject({
      provider: "deepwrite-free",
      modelId: "deepseek-flash",
      group: { key: "free" }
    });
  });
});
