import {
  SUBAGENT_DRAW_VARIANT_MAX_LENGTH,
  type SubagentDrawRef
} from "@deepwrite/contracts/renderer";
import { createScopedTranslator } from "../../i18n";
import type { AgentSubagentDraw } from "../../types/conversation";
import { isRecord } from "./shared";

const t = createScopedTranslator("workspace.parseSubagent");

const PHASES = new Set<AgentSubagentDraw["phase"]>([
  "selecting",
  "evaluating",
  "selected",
  "rejected",
  "failed"
]);
const SELECTED_BY = new Set<NonNullable<AgentSubagentDraw["selectedBy"]>>([
  "user",
  "evaluator",
  "only-success"
]);

function drawCount(value: unknown): number | undefined {
  return Number.isSafeInteger(value) &&
    (value as number) >= 2 &&
    (value as number) <= 10
    ? (value as number)
    : undefined;
}

function drawIndex(value: unknown): number | undefined {
  return Number.isSafeInteger(value) &&
    (value as number) >= 0 &&
    (value as number) < 10
    ? (value as number)
    : undefined;
}

export function parseStoredDrawRef(
  value: unknown
): SubagentDrawRef | undefined {
  if (!isRecord(value)) return undefined;
  const count = drawCount(value.count);
  if (count === undefined) return undefined;
  if (value.role === "evaluator") return { role: "evaluator", count };
  const index = drawIndex(value.index);
  if (value.role !== "candidate" || index === undefined) return undefined;
  const variant = typeof value.variant === "string" ? value.variant.trim() : "";
  return {
    role: "candidate",
    index,
    count,
    ...(variant
      ? { variant: variant.slice(0, SUBAGENT_DRAW_VARIANT_MAX_LENGTH) }
      : {})
  };
}

function optionalString(
  value: Record<string, unknown>,
  key: "selectedSubagentRunId" | "reason" | "note"
): Partial<AgentSubagentDraw> {
  const field = value[key];
  return typeof field === "string" && field ? { [key]: field } : {};
}

/** A selection still open when the app closed can no longer be answered. */
export function parseStoredSubagentDraw(
  value: unknown
): AgentSubagentDraw | undefined {
  if (
    !isRecord(value) ||
    typeof value.key !== "string" ||
    typeof value.parentToolCallId !== "string" ||
    typeof value.subagentId !== "string" ||
    typeof value.name !== "string" ||
    typeof value.updatedAt !== "string" ||
    !PHASES.has(value.phase as AgentSubagentDraw["phase"])
  ) {
    return undefined;
  }
  const count = drawCount(value.count);
  if (count === undefined) return undefined;
  const open = value.phase === "selecting" || value.phase === "evaluating";
  const selectedIndex = drawIndex(value.selectedIndex);
  const batchTask = value.batchTask;
  return {
    key: value.key,
    parentToolCallId: value.parentToolCallId,
    ...(isRecord(batchTask) &&
    Number.isSafeInteger(batchTask.index) &&
    typeof batchTask.key === "string" &&
    Array.isArray(batchTask.dependsOn)
      ? {
          batchTask: {
            index: batchTask.index as number,
            key: batchTask.key,
            dependsOn: batchTask.dependsOn.filter(
              (key): key is string => typeof key === "string"
            )
          }
        }
      : {}),
    subagentId: value.subagentId,
    name: value.name,
    count,
    phase: open ? "failed" : (value.phase as AgentSubagentDraw["phase"]),
    ...(SELECTED_BY.has(value.selectedBy as never)
      ? {
          selectedBy: value.selectedBy as NonNullable<
            AgentSubagentDraw["selectedBy"]
          >
        }
      : {}),
    ...(selectedIndex !== undefined ? { selectedIndex } : {}),
    ...optionalString(value, "selectedSubagentRunId"),
    ...(open
      ? { reason: t("theSubtaskWasStillRunningWhenTheAppClosed") }
      : optionalString(value, "reason")),
    ...optionalString(value, "note"),
    updatedAt: value.updatedAt
  };
}
