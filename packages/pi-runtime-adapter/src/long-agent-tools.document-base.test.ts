import { createHash } from "node:crypto";
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

const sha256 = (text: string) =>
  createHash("sha256").update(text, "utf8").digest("hex");

describe("unified long-form tools: edits carry the text they changed", () => {
  it("sends the hash of the read text so Core can refuse user-edited files", async () => {
    const index = fixtureIndex();
    const worldFile = fixtureWorldFile(index);
    const tools = longTools({
      executor: documentExecutor(index, { [worldFile.id]: "旧规则。" })
    });
    await toolByName(tools, "read").execute("read-world", {
      id: "world_rules"
    });

    const edited = await toolByName(tools, "edit").execute("edit-world", {
      id: "world_rules",
      replacements: [{ original_text: "旧规则", new_text: "新规则" }],
      summary: "修订世界规则"
    });
    expect(edited.details).toMatchObject({
      kind: "long-worldbuilding-file-proposal",
      batch: {
        documentWrites: [
          {
            fileId: worldFile.id,
            mode: "replace",
            content: "新规则。",
            expectedSha256: sha256("旧规则。")
          }
        ]
      }
    });
  });

  it("asks for a fresh read when the file changed after the agent read it", async () => {
    const index = fixtureIndex();
    const worldFile = fixtureWorldFile(index);
    const contents = { [worldFile.id]: "旧规则。" };
    const tools = longTools({ executor: documentExecutor(index, contents) });
    await toolByName(tools, "read").execute("read-world", {
      id: "world_rules"
    });
    contents[worldFile.id] = "旧规则。用户运行中补写的一条。";

    const blocked = resultText(
      await toolByName(tools, "edit").execute("edit-world", {
        id: "world_rules",
        replacements: [{ original_text: "旧规则", new_text: "新规则" }],
        summary: "修订世界规则"
      })
    );
    expect(blocked).toContain("在你读取后已有改动");
    expect(blocked).toContain("请先用 read 完整读取");
  });
});
