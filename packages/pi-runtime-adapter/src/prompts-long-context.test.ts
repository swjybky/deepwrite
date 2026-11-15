import { describe, expect, it } from "vitest";
import type { LongWorkspaceRuntimeContext } from "@deepwrite/contracts";
import {
  buildLongFixedContextLines,
  buildLongFollowUpContextLines
} from "./prompts-long";
import { renderLongCurrentPosition } from "./prompts-long-position";
import { renderLongWorldbuildingDirectory } from "./prompts-long-directory";
import { workspace } from "./long-agent-tools.test-support";

function context(
  activeRoot: LongWorkspaceRuntimeContext["activeRoot"]
): LongWorkspaceRuntimeContext {
  const current = workspace("long", activeRoot, "chapter_one");
  if (activeRoot === "worldbuilding")
    current.worldbuildingFocus = {
      categoryId: "world_rules",
      categoryTitle: "世界规则",
      format: "text",
      currentStage: { kind: "text", title: "世界规则" }
    };
  if (activeRoot === "character_design")
    current.characterFocus = {
      characterId: "character_alice",
      characterName: "林岚",
      group: "protagonist",
      currentDocument: { kind: "relationships", title: "人物关系" }
    };
  if (activeRoot === "plot_design")
    current.plotFocus = {
      section: "plot_point",
      volumeId: "volume_one",
      volumeTitle: "第一卷",
      arcId: "arc_one",
      arcTitle: "主线"
    };
  return current;
}

describe("long workspace context on every turn", () => {
  it.each([
    "worldbuilding",
    "character_design",
    "plot_design",
    "draft",
    "continuity_ledger"
  ] as const)(
    "renders the same current position on first and later %s turns",
    (root) => {
      const current = context(root);
      const position = renderLongCurrentPosition(current);
      expect(buildLongFixedContextLines(current)).toContain(position);
      expect(buildLongFollowUpContextLines(current)).toContain(position);
      expect(position).toContain("read");
      expect(position).not.toContain("file_");
      expect(position).toMatchSnapshot();
      expect(buildLongFollowUpContextLines(current).join("\n")).not.toContain(
        "【list 范围规则】"
      );
    }
  );

  it("updates a follow-up after switching to a same-named character", () => {
    const current = context("character_design");
    current.navigation.characters.push({
      id: "character_other",
      name: "林岚",
      group: "protagonist",
      order: 2
    });
    const before = buildLongFollowUpContextLines(current).at(-1);
    current.characterFocus = {
      ...current.characterFocus!,
      characterId: "character_other",
      currentDocument: { kind: "current_state", title: "当前状态" }
    };
    const after = buildLongFollowUpContextLines(current).at(-1);
    expect(before).toContain("id=character_alice, document=relationships");
    expect(after).toContain("id=character_other, document=current_state");
    expect(after).not.toContain("id=character_alice");
  });

  it("locates an omitted worldbuilding item through its explicit id", () => {
    const current = context("worldbuilding");
    current.worldbuildingFocus = {
      categoryId: "world_factions",
      categoryTitle: "势力",
      format: "list",
      currentStage: {
        kind: "item",
        title: "守夜人",
        itemId: "worlditem_omitted"
      }
    };
    expect(renderLongCurrentPosition(current)).toContain(
      "read（id=worlditem_omitted）"
    );
  });

  it("keeps legacy title-only focus locations usable", () => {
    const current = context("worldbuilding");
    delete current.worldbuildingFocus!.categoryId;
    expect(renderLongCurrentPosition(current)).toContain("id=world_rules");
    const person = context("character_design");
    delete person.characterFocus!.characterId;
    expect(renderLongCurrentPosition(person)).toContain("id=character_alice");
  });

  it("bounds legacy oversized categories at rendering and reports the omitted entries", () => {
    const current = context("worldbuilding");
    const rendered = renderLongWorldbuildingDirectory(
      {
        categories: [
          {
            categoryId: "world_rules",
            title: "规则",
            order: 1,
            format: "list",
            itemCount: 201,
            omittedItemCount: 0,
            items: Array.from({ length: 201 }, (_, index) => ({
              itemId: `worlditem_${index + 1}`,
              title: `条目${index + 1}`,
              order: index + 1
            }))
          }
        ],
        omittedCategoryCount: 0
      },
      current.navigation
    );
    expect(rendered).toContain("item_id=worlditem_200；");
    expect(rendered).not.toContain("item_id=worlditem_201；");
    expect(rendered).toContain("另有 1 项未进入固定上下文");
    expect(rendered).toContain("scope_id=world_rules");
  });
});
