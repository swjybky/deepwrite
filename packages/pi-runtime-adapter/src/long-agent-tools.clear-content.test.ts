import { validateToolArguments } from "@earendil-works/pi-ai";
import {
  describe,
  documentExecutor,
  expect,
  fixtureIndex,
  fixtureWorldFile,
  it,
  longTools,
  resultText,
  toolByName
} from "./long-agent-tools.test-support";

describe("long-form empty content writes", () => {
  it("clears documents through each proposal route and retains their files", async () => {
    const index = fixtureIndex();
    const cases = [
      {
        target: { id: "world_rules" },
        file: fixtureWorldFile(index),
        kind: "long-worldbuilding-file-proposal"
      },
      {
        target: { id: "character_alice", document: "core_profile" },
        file: index.characterFiles[0]!.coreProfile,
        kind: "long-character-file-proposal"
      },
      {
        target: { id: "chapter_one", document: "body" },
        file: index.chapters[0]!.body,
        kind: "long-chapter-write-proposal"
      },
      {
        target: { id: "chapter_one", document: "handoff" },
        file: index.chapters[0]!.handoff,
        kind: "long-continuity-file-proposal"
      },
      {
        target: { id: "book_line" },
        file: index.bookLine,
        kind: "long-mutation-proposal"
      }
    ];
    const beforeText = "需要清空的旧正文。";
    const tools = longTools({
      index,
      autoApproveCrossStageOperations: true,
      executor: documentExecutor(
        index,
        Object.fromEntries(cases.map(({ file }) => [file.id, beforeText]))
      )
    });
    const edit = toolByName(tools, "edit");
    const read = toolByName(tools, "read");
    expect(edit.description).toContain("空字符串表示清空目标正文");
    expect(JSON.stringify(edit.parameters)).toContain("表示清空目标正文");

    for (const { target, file, kind } of cases) {
      const args = validateToolArguments(edit, {
        type: "toolCall",
        id: "clear-content",
        name: "edit",
        arguments: {
          ...target,
          content: "",
          allow_overwrite_existing: true,
          summary: "清空正文"
        }
      });
      expect(resultText(await edit.execute("clear-unread", args))).toContain(
        "请先用 read 完整读取"
      );
      await read.execute("read-before-clear", target);
      expect(
        resultText(
          await edit.execute("clear-unconfirmed", {
            ...target,
            content: "",
            summary: "清空正文"
          })
        )
      ).toContain("allow_overwrite_existing=true");
      const result = await edit.execute(`clear-${file.id}`, args);
      expect(result.details).toMatchObject({
        kind,
        batch: {
          operations: [],
          documentWrites: [{ fileId: file.id, mode: "replace", content: "" }]
        },
        ...(kind === "long-chapter-write-proposal"
          ? { file: { beforeText, afterText: "", operation: "write" } }
          : kind === "long-mutation-proposal"
            ? {}
            : { files: [{ beforeText, afterText: "", operation: "write" }] })
      });
      expect(
        resultText(await read.execute("read-after-clear", target))
      ).not.toContain(beforeText);
      expect(
        (
          await edit.execute(`rewrite-${file.id}`, {
            ...target,
            content: "新的正文。",
            summary: "重新写入"
          })
        ).details
      ).toMatchObject({
        batch: {
          documentWrites: [{ fileId: file.id, content: "新的正文。" }]
        }
      });
    }
  });

  it("clears record-backed content without deleting its record", async () => {
    const index = fixtureIndex();
    index.plot.volumes[0]!.summary = "需要清空的分卷概要。";
    const tools = longTools({ index, executor: documentExecutor(index) });
    const edit = toolByName(tools, "edit");
    const args = { id: "volume_one", content: "", summary: "清空分卷概要" };
    expect(
      resultText(
        await edit.execute("clear-unread", {
          ...args,
          allow_overwrite_existing: true
        })
      )
    ).toContain("请先用 read 完整读取");
    await toolByName(tools, "read").execute("read-volume", { id: args.id });
    expect(resultText(await edit.execute("clear-unconfirmed", args))).toContain(
      "allow_overwrite_existing=true"
    );
    expect(
      (
        await edit.execute("clear-volume", {
          ...args,
          allow_overwrite_existing: true
        })
      ).details
    ).toMatchObject({
      kind: "long-mutation-proposal",
      batch: {
        operations: [
          { type: "volume.update", id: args.id, patch: { summary: "" } }
        ],
        documentWrites: []
      }
    });
  });
});
