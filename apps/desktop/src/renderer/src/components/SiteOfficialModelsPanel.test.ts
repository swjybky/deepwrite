import { describe, expect, it } from "vitest";
import source from "./SiteOfficialModelsPanel.vue?raw";

describe("SiteOfficialModelsPanel", () => {
  it("opens a single shop that sells both official site catalogs", () => {
    expect(source).toContain("小站店铺");
    expect(source).toContain('href="https://pay.ldxp.cn/shop/UKGFTY58"');
    expect(source).toContain('class="site-shop-button"');
    expect(source).not.toContain("新小站店铺");
    expect(source).not.toContain("旧小站店铺");
    expect(source).not.toContain("https://www.aideepwrite.com");
    expect(source).toContain('target="_blank"');
    expect(source).toContain('rel="noopener noreferrer"');
  });

  it("asks the user for a separate model key before showing the model", () => {
    expect(source).toContain("添加你的新小站密钥");
    expect(source).toContain('type="password"');
    expect(source).toContain('autocomplete="new-password"');
    expect(source).toContain('emit("saveToken", apiKey)');
    expect(source).toContain("保存密钥后，相关模型才会加入模型列表");
    expect(source).not.toContain("MAIN_VITE_DEEPWRITE_GATEWAY_API_KEY");
  });

  it("never renders the saved key and supports testing or removing the model", () => {
    expect(source).toContain("configuredModels.value.some");
    expect(source).toContain("密钥明文不会回传到页面");
    expect(source).toContain("emit('clearToken')");
    expect(source).toContain('emit("test", toModelInput(model))');
  });

  it("renders every model discovered from the new-site catalog", () => {
    expect(source).toContain("props.settings?.models.filter");
    expect(source).toContain('v-for="model in configuredModels"');
    expect(source).toContain("`${configuredModels.length} 个模型`");
    expect(source).toContain("model.api");
  });

  it("refreshes the full page, controls selector visibility, and shows quota progress", () => {
    expect(source).toContain("刷新页面");
    expect(source).toContain("emit('refresh')");
    expect(source).toContain('role="switch"');
    expect(source).toContain('emit("setModelEnabled"');
    expect(source).toContain('role="progressbar"');
    expect(source).toContain("当前密钥剩余额度");
    expect(source).toContain("quotaUsedPercentage");
    expect(source).toContain("无限额度");
    expect(source).toContain("quota?.unlimited");
  });
});
