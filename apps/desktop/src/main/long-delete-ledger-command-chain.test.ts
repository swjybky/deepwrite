import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

const contractSource = source(
  "../../../../packages/contracts/src/long-workspace-commands.ts"
);
const preloadSource = source("../preload/long-document-api.ts");
const coreSource = source("../utilities/long-core-commands.ts");
const serviceSource = source("../utilities/long-workspace-service.ts");
const mainSource = source("./ipc/long-workspace-commands.ts");

describe("long.deleteLedgerCommit command chain", () => {
  it("keeps the command and result schema-validated across every process boundary", () => {
    expect(contractSource).toContain(
      'type: z.literal("long.deleteLedgerCommit")'
    );
    expect(preloadSource).toContain(
      'createEnvelope("long.deleteLedgerCommit", input'
    );
    expect(preloadSource).toContain("LongDeleteLedgerCommitResultSchema");
    expect(mainSource).toContain('case "long.deleteLedgerCommit"');
    expect(mainSource).toContain("LongDeleteLedgerCommitResultSchema.parse");
    expect(coreSource).toContain('command.type === "long.deleteLedgerCommit"');
    expect(coreSource).toContain(
      "await service.deleteLedgerCommit(command.payload)"
    );
    expect(serviceSource).toContain("LongDeleteLedgerCommitInputSchema.parse");
    expect(serviceSource).toContain(
      "await this.store.deleteLedgerCommit(opened.projectDirectory"
    );
    expect(serviceSource).toContain("LongDeleteLedgerCommitResultSchema.parse");
  });
});
