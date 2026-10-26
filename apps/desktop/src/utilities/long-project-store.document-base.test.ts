import { LongWorkspaceOperationError } from "@deepwrite/contracts";
import {
  FIXED_NOW,
  createFixture,
  describe,
  expect,
  firstChapterFiles,
  it,
  projectTransactionContentSha256
} from "./long-project-store.test-support";

const sha = (text: string) => projectTransactionContentSha256(text);

describe("LongProjectStore: agent writes check the text they edited", () => {
  it("refuses to overwrite a chapter the user edited after the agent read it", async () => {
    const { projectStore, created } = await createFixture("document-base");
    const directory = created.projectDirectory;
    const { body } = firstChapterFiles(created.book);
    const agentBase = "第一章初稿。\n";
    const userEdit = "第一章初稿。\n用户在智能体运行时补写的一句。\n";
    await projectStore.writeDocument(directory, {
      fileId: body.id,
      content: agentBase
    });
    await projectStore.writeDocument(directory, {
      fileId: body.id,
      content: userEdit
    });
    const write = (expectedSha256?: string) =>
      projectStore.applyWorkspaceOperations(directory, {
        batch: {
          updatedAt: FIXED_NOW,
          operations: [],
          documentWrites: [
            {
              proposalId: "proposal_proofread",
              fileId: body.id,
              mode: "replace",
              content: "第一章校对稿。\n",
              updatedAt: FIXED_NOW,
              reason: "校对第一章",
              ...(expectedSha256 ? { expectedSha256 } : {})
            }
          ]
        }
      });

    const rejected = await write(sha(agentBase)).catch(
      (error: unknown) => error
    );
    expect(rejected).toBeInstanceOf(LongWorkspaceOperationError);
    expect(rejected).toMatchObject({
      code: "document_changed",
      details: { fileId: body.id, actualSha256: sha(userEdit) }
    });
    await expect(
      projectStore.readDocument(directory, { fileId: body.id })
    ).resolves.toMatchObject({ content: userEdit });

    // Overwrite after the user confirmed the version Core reported.
    await write(sha(userEdit));
    await expect(
      projectStore.readDocument(directory, { fileId: body.id })
    ).resolves.toMatchObject({ content: "第一章校对稿。\n" });
  });

  it("keeps writes without a base hash working for older proposals", async () => {
    const { projectStore, created } = await createFixture("document-legacy");
    const directory = created.projectDirectory;
    const { body } = firstChapterFiles(created.book);
    await projectStore.writeDocument(directory, {
      fileId: body.id,
      content: "用户正文。\n"
    });
    await projectStore.applyWorkspaceOperations(directory, {
      batch: {
        updatedAt: FIXED_NOW,
        operations: [],
        documentWrites: [
          {
            proposalId: "proposal_legacy",
            fileId: body.id,
            mode: "replace",
            content: "旧版提案正文。\n",
            updatedAt: FIXED_NOW,
            reason: "旧版提案"
          }
        ]
      }
    });
    await expect(
      projectStore.readDocument(directory, { fileId: body.id })
    ).resolves.toMatchObject({ content: "旧版提案正文。\n" });
  });
});
