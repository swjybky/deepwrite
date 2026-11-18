import { StringEnum, Type, type Static } from "@earendil-works/pi-ai";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import {
  DecompositionToolJsonSchemas,
  DecompositionSubmissionDataSchema,
  DecompositionReceiptSchema,
  type DecompositionReceipt,
  type DecompositionSubmissionData,
  type ExtrasAgentResolvedTaskOf
} from "@deepwrite/contracts";
import type { ExtrasAgentRunServices } from "../../definition";
import { extrasOutputResult } from "../../output";
import { defineStrictTool, textToolResult } from "../../tools/analysis-inputs";
import type { DecompositionRole } from "./roles";
import {
  STAGED_TOOLS,
  assetKinds,
  dataKinds,
  roleSubmissionTools,
  stagedCompletionNotes,
  submissionNotes,
  submissionUnitIds
} from "./submission-kinds";
import {
  decodeReadingEvidence,
  describeSubmissionIssues,
  relaxedSubmissionSchema,
  repairSubmissionArguments,
  withEmptyCollections
} from "./submission-schema";
type Task = ExtrasAgentResolvedTaskOf<"long-book-decomposition">;
export async function saveDecompositionSubmission(
  task: Task,
  services: ExtrasAgentRunServices,
  unitId: string,
  rawData: unknown
): Promise<{
  data: DecompositionSubmissionData;
  receipt: DecompositionReceipt;
}> {
  if (!services.decompositionSubmit)
    throw new Error("拆解持久化提交桥不可用。");
  const data = DecompositionSubmissionDataSchema.parse(rawData);
  const unit = task.input.units[unitId];
  if (!unit) throw new Error("提交单元不在本工作包授权范围内。");
  const receipt = DecompositionReceiptSchema.parse(
    await services.decompositionSubmit({
      jobId: task.input.jobId,
      outputVersion: task.input.outputVersion,
      attemptId: task.input.attemptId,
      unitId,
      inputRevision: unit.inputRevision,
      data
    })
  );
  if (
    receipt.jobId !== task.input.jobId ||
    receipt.unitId !== unitId ||
    receipt.inputRevision !== unit.inputRevision ||
    receipt.outputVersion !== task.input.outputVersion
  )
    throw new Error("保存回执与本次提交不一致。");
  return { data, receipt };
}
function decompositionOutput(
  task: Task,
  unitId: string,
  data: DecompositionSubmissionData,
  receipt: DecompositionReceipt,
  message = "真实内容与回执已保存。"
) {
  const kind =
    data.kind === "reading" || data.kind === "finish-card"
      ? "decomposition-card"
      : data.kind === "registry" || data.kind === "registry-plan"
        ? "decomposition-registry"
        : data.kind === "review"
          ? "decomposition-review"
          : "decomposition-asset";
  return extrasOutputResult(
    { agentId: "long-book-decomposition", jobId: task.input.jobId },
    message,
    { kind, outputVersion: receipt.outputVersion, unitId, receipt }
  );
}
export async function persistDecompositionSubmission(
  task: Task,
  services: ExtrasAgentRunServices,
  unitId: string,
  rawData: unknown
) {
  const { data, receipt } = await saveDecompositionSubmission(
    task,
    services,
    unitId,
    rawData
  );
  return decompositionOutput(task, unitId, data, receipt);
}
const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
/** The tool decides the kinds; whatever the model sent for them is replaced. */
function withToolKind(name: string, data: unknown): unknown {
  if (!isObject(data)) return data;
  const asset = assetKinds[name];
  if (!asset) return { ...data, kind: dataKinds[name] };
  return {
    ...data,
    kind: "asset",
    asset: isObject(data.asset) ? { ...data.asset, kind: asset } : data.asset
  };
}
/** A chunk completes as soon as every one of its checkpoints is saved. */
export async function finishChunks(
  task: Task,
  services: ExtrasAgentRunServices,
  saved: ReadonlySet<string>
) {
  const finished: Array<{ unitId: string; receipt: DecompositionReceipt }> = [];
  for (const id of task.input.unitIds) {
    const chunk = task.input.units[id];
    if (!id.startsWith("chunk:") || !chunk || chunk.status === "done") continue;
    const complete = chunk.dependencies.every(
      (dependency) =>
        saved.has(dependency) || task.input.units[dependency]?.status === "done"
    );
    if (!complete) continue;
    const { receipt } = await saveDecompositionSubmission(task, services, id, {
      kind: "finish-card"
    });
    chunk.status = "done";
    finished.push({ unitId: id, receipt });
  }
  return finished;
}
/** Calls in a row that save nothing before the error also advises stopping. */
const STALLED_ADVICE_AFTER = 4;
/**
 * Role tools take a batch: one call saves every unit the child finished, so
 * results do not cost a request each. Each item is validated and saved on
 * its own, so one bad item never discards the rest. Tool schemas carry no
 * task ids, which keeps them identical for every child of a role; ids are
 * checked here and again by Main and Core.
 */
export function decompositionSubmissionTools(
  task: Task,
  services: ExtrasAgentRunServices,
  role: DecompositionRole
): AgentTool[] {
  return roleSubmissionTools[role].map((name) => {
    const ids = submissionUnitIds(task, name, role);
    const schema = (DecompositionToolJsonSchemas as Record<string, object>)[
      dataKinds[name]!
    ]!;
    const staged = STAGED_TOOLS.has(name);
    const parameters = Type.Object({
      items: Type.Array(
        Type.Object({
          unitId: Type.String(),
          data: Type.Unsafe<unknown>(relaxedSubmissionSchema(schema) as object),
          ...(staged
            ? {
                batch_mode: Type.Optional(
                  StringEnum(["partial", "final"] as const, {
                    description:
                      "partial 只暂存本批条目，单元未完成；final（默认）带齐文字字段，合并所有批次并完成单元。"
                  })
                )
              }
            : {})
        }),
        { minItems: 1, maxItems: 20 }
      )
    });
    // Consecutive calls that saved nothing. Errors always go back to the model
    // to fix and resend; a long streak adds advice but never ends the child.
    let stalled = 0;
    const tool = defineStrictTool({
      name,
      label: name,
      description: `批量提交本任务单元的完整结构化产出，items 每项写成 {unitId, data}；kind 由工具填写，没有内容的列表可省略。每项单独校验并立即保存，逐项返回结果，失败项按提示修正后只重交失败项。字段说明里的数量与字数上限必须遵守。单元 id 见任务消息。${staged ? "条目超过任务消息给出的每批上限时分批提交：前几批带 batch_mode=partial 只交条目，最后一批用 final 或省略 batch_mode。" : ""}${stagedCompletionNotes[name] ?? ""}${submissionNotes[name] ?? ""}`,
      parameters,
      execute: async (_id, params) => {
        if (!ids.length) throw new Error("本任务没有此类单元可提交。");
        const saved = new Set<string>();
        const lines: string[] = [];
        let progressed = false;
        let last:
          | {
              unitId: string;
              data: DecompositionSubmissionData;
              receipt: DecompositionReceipt;
            }
          | undefined;
        for (const item of params.items) {
          try {
            if (!ids.includes(item.unitId))
              throw new Error("提交单元不在本工作包授权范围内。");
            if (staged && Object.hasOwn(item, "more")) {
              throw new Error(
                "请用 batch_mode=partial 暂存，或用 batch_mode=final 完成本单元。"
              );
            }
            const filled = withEmptyCollections(
              schema,
              withToolKind(name, item.data)
            );
            const partial = staged && item.batch_mode === "partial";
            const data =
              partial && isObject(filled)
                ? { ...filled, kind: "asset-part" }
                : name === "submit_chapter_reading"
                  ? decodeReadingEvidence(filled)
                  : filled;
            const checked = DecompositionSubmissionDataSchema.safeParse(data);
            if (!checked.success)
              throw new Error(
                `格式校验失败：${describeSubmissionIssues(checked.error.issues, data)}${staged && !partial ? `；若本批只是中间批次，将 batch_mode=partial 放在 unitId、data 同级；若要完成单元，补齐必填文字字段并省略 batch_mode。${stagedCompletionNotes[name]}` : ""}`
              );
            const result = await saveDecompositionSubmission(
              task,
              services,
              item.unitId,
              checked.data
            );
            progressed = true;
            if (partial) {
              lines.push(
                `${item.unitId}：本批已暂存（累计 ${result.receipt.staged ?? 0} 条），单元未完成；继续提交其余条目，最后一批省略 batch_mode。${stagedCompletionNotes[name]}`
              );
              continue;
            }
            saved.add(item.unitId);
            task.input.units[item.unitId]!.status = "done";
            last = { unitId: item.unitId, ...result };
            lines.push(`${item.unitId}：已保存`);
          } catch (error) {
            lines.push(
              `${item.unitId}：未保存（${error instanceof Error ? error.message : "保存失败"}）`
            );
          }
        }
        if (role === "reader")
          for (const chunk of await finishChunks(task, services, saved)) {
            last = {
              unitId: chunk.unitId,
              data: { kind: "finish-card" },
              receipt: chunk.receipt
            };
            lines.push(`${chunk.unitId}：本块全部章节已保存，阅读块已完成`);
          }
        const pending = ids.filter(
          (id) => task.input.units[id]?.status !== "done"
        );
        if (pending.length) lines.push(`仍未保存：${pending.join("、")}`);
        stalled = progressed ? 0 : stalled + 1;
        if (!last && progressed)
          return textToolResult(lines.join("\n"), { kind: "none" });
        if (!last) {
          if (stalled >= STALLED_ADVICE_AFTER)
            lines.push(
              `已连续 ${stalled} 次没有保存任何单元。数据问题按上面的提示修正后重交；保存失败等改数据也解决不了的问题，停止提交，在最终回复中列出未保存单元及原因，系统会在后续工作包重试。`
            );
          throw new Error(lines.join("\n"));
        }
        return decompositionOutput(
          task,
          last.unitId,
          last.data,
          last.receipt,
          lines.join("\n")
        );
      }
    });
    tool.prepareArguments = (args) => {
      const params = repairSubmissionArguments(args) as Static<
        typeof parameters
      >;
      if (staged && Array.isArray(params?.items)) {
        for (const [index, item] of params.items.entries()) {
          const mode = item?.batch_mode;
          if (mode !== undefined && mode !== "partial" && mode !== "final")
            throw new Error(
              `items.${index}.batch_mode：请使用 partial 暂存，或使用 final 完成本单元。`
            );
        }
      }
      return params;
    };
    return tool;
  });
}
