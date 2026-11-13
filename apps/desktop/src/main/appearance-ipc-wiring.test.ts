import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(relativeUrl: string): string {
  return readFileSync(new URL(relativeUrl, import.meta.url), "utf8");
}

describe("appearance IPC wiring", () => {
  it("routes both main dispatch paths through the shared appearance handler", () => {
    const mainSource = source("./index.ts");
    const modularSource = source("./ipc/settings-commands.ts");

    expect(mainSource).toContain("handleAppearanceCommands(");
    expect(mainSource).toContain("requireAppearanceService");
    expect(mainSource).toContain(
      "registerAppearanceFontScheme(schemeCollector);"
    );
    expect(mainSource).toContain("registerCoverScheme(schemeCollector);");
    expect(mainSource).toContain("registerBookImageScheme(schemeCollector);");
    expect(
      mainSource.match(
        /protocol\.registerSchemesAsPrivileged\(privilegedSchemes\)/g
      )
    ).toHaveLength(1);
    expect(mainSource).toContain(
      "installAppearanceFontProtocolHandler(appearanceService);"
    );
    expect(mainSource).not.toContain('if (command.type === "appearance.list")');
    expect(modularSource).toContain("handleAppearanceCommands(ctx, command)");
    expect(modularSource).not.toContain(
      'if (command.type === "appearance.list")'
    );
  });

  it("uses one preload appearance API from both entry points", () => {
    const preloadSource = source("../preload/index.ts");
    const settingsApiSource = source("../preload/settings-api.ts");

    expect(preloadSource).toContain(
      'import { appearance } from "./appearance-api"'
    );
    expect(preloadSource).toContain("  appearance,");
    expect(preloadSource).not.toContain("async function listAppearance(");
    expect(settingsApiSource).toContain('from "./appearance-api"');
    expect(settingsApiSource).not.toContain("function listAppearance(");
  });

  it("allows only the registered custom-font scheme in font CSP", () => {
    const rendererHtml = source("../renderer/index.html");
    expect(rendererHtml).toContain("font-src 'self' data: deepwrite-font:;");
  });
});
