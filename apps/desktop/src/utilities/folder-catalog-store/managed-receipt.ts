import { join } from "node:path";
import {
  MaterialLibraryProjectManifestSchema,
  DecompositionReceiptSchema,
  type DecompositionReceipt
} from "@deepwrite/contracts";
import { readNoFollowFile } from "../long-project-store/io";
import {
  commitProjectTransaction,
  recoverProjectTransaction,
  type ProjectTransactionFileOperation
} from "../project-transaction";
import { sha256Hex } from "@deepwrite/shared/node";

/** Adopts user edits as the job's latest version; later writes must ask again. The receipt and CAS checks share a transaction. */
export async function adoptManagedMaterialReceipt(
  root: string,
  raw: DecompositionReceipt
) {
  await recoverProjectTransaction(root);
  const manifestDisk = await readNoFollowFile(
    join(root, "deepwrite.json"),
    4 * 1024 * 1024,
    "素材清单",
    root
  );
  const manifest = MaterialLibraryProjectManifestSchema.parse(
    JSON.parse(manifestDisk.bytes.toString("utf8"))
  );
  const saved = manifest.writeReceipts?.find(({ id }) => id === raw.id);
  if (saved)
    return DecompositionReceiptSchema.parse(
      JSON.parse(
        (
          await readNoFollowFile(
            join(root, saved.path),
            4 * 1024 * 1024,
            "素材回执",
            root
          )
        ).bytes.toString("utf8")
      )
    );
  const operations: ProjectTransactionFileOperation[] = [];
  const receipt = structuredClone(raw);
  for (const ref of receipt.refs) {
    const entry = manifest.entries.find(({ id }) => id === ref.resourceId);
    if (!entry || ref.projectId !== manifest.id)
      throw new Error("用户内容不在本任务的目标库中。");
    const disk = await readNoFollowFile(
      join(root, entry.path),
      32 * 1024 * 1024,
      "用户素材",
      root
    );
    const content = disk.bytes.toString("utf8");
    ref.sha256 = sha256Hex(content);
    ref.userOwned = true;
    ref.revision = manifest.revision + 1;
    operations.push({
      action: "check",
      path: entry.path,
      expectedSha256: sha256Hex(content)
    });
  }
  const path = `receipts/${receipt.id}.md`;
  const next = MaterialLibraryProjectManifestSchema.parse({
    ...manifest,
    revision: manifest.revision + 1,
    updatedAt: receipt.savedAt,
    writeReceipts: [...(manifest.writeReceipts ?? []), { id: receipt.id, path }]
  });
  await commitProjectTransaction({
    projectRoot: root,
    operations: [
      ...operations,
      {
        path,
        content: JSON.stringify(DecompositionReceiptSchema.parse(receipt)),
        expectedSha256: null
      },
      {
        path: "deepwrite.json",
        content: JSON.stringify(next),
        expectedSha256: sha256Hex(manifestDisk.bytes.toString("utf8"))
      }
    ]
  });
  return receipt;
}
