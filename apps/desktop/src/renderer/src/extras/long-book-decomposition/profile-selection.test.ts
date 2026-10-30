import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_DECOMPOSITION_PROFILE,
  type DeepWriteApi,
  type LongBookDecompositionProfile
} from "@deepwrite/contracts/renderer";
import { useLongBookDecomposition } from "./useLongBookDecomposition";

const custom = (id: string, name: string): LongBookDecompositionProfile => ({
  id,
  name,
  description: `${name}方案`,
  systemPrompt: "",
  worldCategories: [{ id: "sects", title: "宗门" }]
});

/** Main answers a save with the stored list, built-ins flagged again. */
function setup(initial: LongBookDecompositionProfile[]) {
  let stored = initial;
  const save = vi.fn(
    async ({ profiles }: { profiles: LongBookDecompositionProfile[] }) => {
      stored = profiles.map((profile) =>
        profile.id === DEFAULT_DECOMPOSITION_PROFILE.id
          ? { ...profile, builtin: true }
          : profile
      );
      return { profiles: structuredClone(stored) };
    }
  );
  const controller = useLongBookDecomposition({
    api: () =>
      ({ extrasAgents: { profiles: { save } } }) as unknown as DeepWriteApi
  });
  controller.profiles.value = structuredClone(initial);
  return { controller, save };
}

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  dispose = undefined;
});

describe("拆解模版保存后的选择", () => {
  it("保存时选中本次新建的模版，多个时选最后新建的", async () => {
    const { controller } = setup([DEFAULT_DECOMPOSITION_PROFILE]);
    dispose = controller.dispose;
    expect(controller.profileId.value).toBe(DEFAULT_DECOMPOSITION_PROFILE.id);
    await controller.saveProfiles([
      DEFAULT_DECOMPOSITION_PROFILE,
      custom("decomposition_a", "仙侠"),
      custom("decomposition_b", "都市")
    ]);
    expect(controller.profileId.value).toBe("decomposition_b");
    expect(controller.selectedProfile.value.name).toBe("都市");
  });

  it("只编辑已有模版时保留当前选择", async () => {
    const { controller } = setup([
      DEFAULT_DECOMPOSITION_PROFILE,
      custom("decomposition_a", "仙侠")
    ]);
    dispose = controller.dispose;
    await controller.saveProfiles([
      { ...DEFAULT_DECOMPOSITION_PROFILE, name: "通用（改）" },
      custom("decomposition_a", "仙侠")
    ]);
    expect(controller.profileId.value).toBe(DEFAULT_DECOMPOSITION_PROFILE.id);
  });

  it("当前模版被删除时回到第一个，恢复的内置模版不算新建", async () => {
    const { controller } = setup([
      custom("decomposition_a", "仙侠"),
      custom("decomposition_b", "都市")
    ]);
    dispose = controller.dispose;
    controller.profileId.value = "decomposition_b";
    await controller.saveProfiles([custom("decomposition_a", "仙侠")]);
    expect(controller.profileId.value).toBe("decomposition_a");

    await controller.saveProfiles([
      DEFAULT_DECOMPOSITION_PROFILE,
      custom("decomposition_a", "仙侠")
    ]);
    expect(controller.profileId.value).toBe("decomposition_a");
  });
});
