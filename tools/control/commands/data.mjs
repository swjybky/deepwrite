import { openControlSession } from "../lib/control-client.mjs";
import {
  findFixtures,
  listFixtures,
  loadFixture,
  outline,
  readLedger,
  writeLedger
} from "../lib/fixtures.mjs";
import { assertStopped, removeInside, resetTargets } from "../lib/instance.mjs";
import { CliError } from "../lib/output.mjs";
import {
  copySnapshotBack,
  listSnapshots,
  readSnapshot,
  takeSnapshot
} from "../lib/snapshots.mjs";

const DRY_RUN = {
  type: "boolean",
  description: "只列出将要发生的变更，不做任何修改"
};

async function withSession(layout, action) {
  const session = await openControlSession(layout, { timeoutMs: 30_000 });
  try {
    return await action(session);
  } finally {
    session.close();
  }
}

async function contents(session) {
  const { works } = await session.call("list_works");
  const { libraries } = await session.call("list_libraries");
  return {
    works: works.map(({ id, type, title }) => ({ id, type, title })),
    libraries: libraries.map(({ id, domain, kind, title, entryCount }) => ({
      id,
      domain,
      kind,
      title,
      entryCount
    }))
  };
}

export const dataCommands = {
  summary: "测试数据：合成数据集、灌入、列出、快照与恢复、按 id 删除",
  commands: {
    fixtures: {
      summary: "列出内置的合成数据集",
      description:
        "数据集在 tools/control/fixtures/，内容全部虚构，不含真实作品。每个数据集列出会建的作品、文档与资料库。",
      options: {},
      examples: ["pnpm -s ctl data fixtures"],
      output: { fixtures: "name、summary、works、libraries" },
      errors: {},
      run: async () => ({
        data: { fixtures: (await listFixtures()).map(outline) }
      })
    },
    load: {
      summary: "把数据集灌入运行中的测试实例",
      description:
        "经控制接口建作品、写文档、建资料库与条目，与 MCP 智能体走同一条写入路径，Core 仍是唯一写入者。建好的每一项记进台账（fixtures.json），data clear --loaded 可精确清掉。重复灌入会再建一份同名作品。长篇只写已有的文档，控制接口不支持加章节。",
      positionals: [
        {
          name: "fixtures",
          required: true,
          description: "逗号分隔的数据集名，见 data fixtures"
        }
      ],
      options: {},
      examples: [
        "pnpm -s ctl data load short",
        "pnpm -s ctl data load short,long,libraries"
      ],
      output: { loaded: "kind、id、title 与写入的文档或条目数" },
      errors: {
        "data.unknown_fixture": "数据集名不对",
        "data.fixture_outdated": "作品结构与数据集不符，按 details 更新数据集",
        "app.control_unavailable": "实例没在运行，先 env start",
        "app.tool_rejected":
          "某一步写入被拒绝，已建部分可用 data clear --loaded 清掉"
      },
      run: async ({ layout, args }) => {
        const fixtures = await findFixtures(args.fixtures);
        const loaded = await withSession(layout, async (session) => {
          const items = [];
          for (const fixture of fixtures) {
            for (const item of await loadFixture(layout, session, fixture)) {
              items.push({ fixture: fixture.name, ...item });
            }
          }
          return items;
        });
        return {
          data: { loaded },
          nextSteps: ["界面列表若没刷新，用 pnpm -s ctl app state 或截图确认"]
        };
      }
    },
    list: {
      summary: "列出测试实例里的作品与资料库、已有快照和数据集台账",
      description:
        "只读。作品与资料库要实例在运行才能读，没运行时 works 为 null；快照与台账总能读。",
      options: {},
      examples: ["pnpm -s ctl data list"],
      output: {
        works: "id、type、title",
        libraries: "id、domain、kind、title、entryCount",
        snapshots: "快照名与时间",
        loaded: "data load 建过、尚未清掉的项"
      },
      errors: {},
      run: async ({ layout }) => {
        const live = await withSession(layout, contents).catch((error) => ({
          works: null,
          libraries: null,
          unavailable: error.code ?? error.message
        }));
        return {
          data: {
            ...live,
            snapshots: await listSnapshots(layout),
            loaded: (await readLedger(layout)).items
          }
        };
      }
    },
    snapshot: {
      summary: "给测试数据拍快照（实例须已停止）",
      description:
        "复制 profile/（不含 config/ 与 Chromium 缓存）、workspace/ 与数据集台账到 snapshots/<名>/。实例运行时文件可能写到一半，所以拒绝执行。",
      positionals: [{ name: "name", required: true, description: "快照名" }],
      options: {},
      examples: ["pnpm -s ctl env stop && pnpm -s ctl data snapshot baseline"],
      output: { name: "快照名", createdAt: "时间", directory: "快照目录" },
      errors: {
        "env.running": "先 env stop",
        "data.snapshot_exists": "换一个快照名"
      },
      run: async ({ layout, args }) => {
        await assertStopped(layout, "拍快照");
        return { data: await takeSnapshot(layout, args.name) };
      }
    },
    restore: {
      summary: "用快照替换当前测试数据（实例须已停止）",
      description:
        "先删除 profile/ 中除 config/ 外的内容、workspace/ 与 control/ 的内容（同 env reset），再把快照复制回来。测试配置保持当前 seed 的结果。数据集台账一并恢复为拍快照时的样子。",
      positionals: [{ name: "name", required: true, description: "快照名" }],
      options: { "dry-run": DRY_RUN },
      examples: [
        "pnpm -s ctl data restore baseline --dry-run",
        "pnpm -s ctl data restore baseline"
      ],
      output: { removed: "删除（或将删除）的路径", restoredFrom: "快照目录" },
      errors: {
        "env.running": "先 env stop",
        "data.unknown_snapshot": "快照不存在"
      },
      run: async ({ layout, args, values }) => {
        await assertStopped(layout, "恢复快照");
        const { directory, meta } = await readSnapshot(layout, args.name);
        const removed = await resetTargets(layout);
        if (!values["dry-run"]) {
          await removeInside(layout, removed);
          await copySnapshotBack(layout, directory);
        }
        return {
          data: {
            dryRun: Boolean(values["dry-run"]),
            removed,
            restoredFrom: directory,
            snapshot: meta
          }
        };
      }
    },
    clear: {
      summary: "按 id 删除测试实例里的作品或资料库（进回收站，可恢复）",
      description:
        "经控制接口删除，删除项进回收站，可用 restore_trash_item 恢复。--loaded 删除台账里 data load 建过的全部项。要彻底清空请用 env reset。",
      options: {
        id: {
          type: "string",
          valueName: "id",
          description: "逗号分隔的作品或资料库 id，见 data list"
        },
        loaded: {
          type: "boolean",
          description: "删除台账里 data load 建过的全部项"
        },
        "dry-run": DRY_RUN
      },
      examples: [
        "pnpm -s ctl data clear --loaded --dry-run",
        "pnpm -s ctl data clear --id book-1234abcd"
      ],
      output: { deleted: "kind、id、title、trashId（dry-run 时没有 trashId）" },
      errors: {
        "cli.invalid_arguments": "--id 与 --loaded 至少给一个",
        "data.unknown_id": "测试实例里没有这个 id",
        "app.control_unavailable": "实例没在运行，先 env start"
      },
      run: async ({ layout, values }) => {
        if (!values.id && !values.loaded) {
          throw new CliError(
            "cli.invalid_arguments",
            "需要 --id 或 --loaded。",
            {
              nextSteps: ["运行 pnpm -s ctl data list 查看 id"]
            }
          );
        }
        const ledger = await readLedger(layout);
        const ids = new Set([
          ...(values.id ?? "")
            .split(",")
            .map((id) => id.trim())
            .filter(Boolean),
          ...(values.loaded ? ledger.items.map(({ id }) => id) : [])
        ]);
        return withSession(layout, async (session) => {
          const { works, libraries } = await contents(session);
          const targets = [
            ...works.map((work) => ({ kind: "work", ...work })),
            ...libraries.map((library) => ({ kind: "library", ...library }))
          ].filter(({ id }) => ids.has(id));
          const missing = [...ids].filter(
            (id) => !targets.some((t) => t.id === id)
          );
          if (values.id && missing.length > 0 && !values.loaded) {
            throw new CliError(
              "data.unknown_id",
              `测试实例里没有：${missing.join(", ")}`,
              {
                nextSteps: ["运行 pnpm -s ctl data list 查看现有 id"]
              }
            );
          }
          const deleted = [];
          for (const target of targets) {
            const item = {
              kind: target.kind,
              id: target.id,
              title: target.title
            };
            if (!values["dry-run"]) {
              const result = await session.call(
                target.kind === "work" ? "manage_work" : "manage_library",
                {
                  action: "delete",
                  ...(target.kind === "work"
                    ? { workId: target.id }
                    : { libraryId: target.id })
                }
              );
              item.trashId = result.trashId;
            }
            deleted.push(item);
          }
          if (!values["dry-run"]) {
            await writeLedger(layout, {
              items: ledger.items.filter(({ id }) => !ids.has(id))
            });
          }
          return {
            data: {
              dryRun: Boolean(values["dry-run"]),
              deleted,
              ...(missing.length > 0 ? { alreadyGone: missing } : {})
            }
          };
        });
      }
    }
  }
};
