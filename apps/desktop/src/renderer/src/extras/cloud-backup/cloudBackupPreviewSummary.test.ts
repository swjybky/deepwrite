import { describe, expect, it } from "vitest";
import type { CloudBackupChange } from "@deepwrite/contracts";
import { summarizeCloudBackupPreview } from "./cloudBackupPreviewSummary";

function change(
  id: string,
  status: CloudBackupChange["change"]
): CloudBackupChange {
  return {
    kind: "book",
    change: status,
    id,
    title: id,
    sizeBytes: 10
  };
}

describe("summarizeCloudBackupPreview", () => {
  it("reports the total and every status, including statuses with no files", () => {
    expect(
      summarizeCloudBackupPreview([
        change("new", "add"),
        change("changed", "overwrite"),
        change("same-1", "keep"),
        change("same-2", "keep")
      ])
    ).toEqual({
      total: 4,
      statuses: [
        { change: "add", label: "将新增", count: 1 },
        { change: "overwrite", label: "将覆盖", count: 1 },
        { change: "keep", label: "不会改动", count: 2 },
        { change: "drop", label: "云端将移除", count: 0 }
      ]
    });
  });
});
