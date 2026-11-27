import type { ModelConfig, ModelConfigInput } from "@deepwrite/contracts";

export type ModelTestStatus =
  "testing" | "cancelling" | "succeeded" | "failed" | "cancelled";

export interface ModelTestStateEntry {
  readonly modelId: string;
  readonly modelLabel: string;
  readonly requestId: string;
  readonly configSignature: string;
  readonly status: ModelTestStatus;
  readonly message: string;
  readonly errorCode?: string;
  readonly updatedAt: number;
}

export type ModelTestConfigLike = Pick<
  ModelConfig | ModelConfigInput,
  | "id"
  | "provider"
  | "modelId"
  | "requestModelId"
  | "supportsDeveloperRole"
  | "toolSchemaProfile"
  | "api"
  | "baseUrl"
  | "reasoning"
  | "defaultThinkingLevel"
  | "temperatureOptions"
  | "modelKind"
> & {
  apiKey?: string | undefined;
  clearApiKey?: boolean | undefined;
  sourceApiKeyId?: string | undefined;
};

export function modelTestConfigSignature(model: ModelTestConfigLike): string {
  return JSON.stringify([
    model.id,
    model.modelKind === "jev" ? "jev" : "llm",
    model.provider.trim().toLowerCase(),
    model.modelId.trim(),
    model.requestModelId?.trim() ?? "",
    model.api,
    model.baseUrl.trim(),
    Boolean(model.reasoning),
    model.reasoning ? model.defaultThinkingLevel : "off",
    model.reasoning ? [] : [...model.temperatureOptions],
    model.toolSchemaProfile ?? "auto",
    model.supportsDeveloperRole ?? null,
    model.apiKey?.trim() ?? "",
    Boolean(model.clearApiKey),
    model.sourceApiKeyId?.trim() ?? ""
  ]);
}

export function isModelTestActiveStatus(
  status: ModelTestStatus | undefined
): boolean {
  return status === "testing" || status === "cancelling";
}

export function shouldDisplayModelTestStatus(
  entry: ModelTestStateEntry | undefined,
  currentSignature?: string
): entry is ModelTestStateEntry {
  if (!entry) return false;
  if (isModelTestActiveStatus(entry.status) || entry.status === "cancelled") {
    return true;
  }
  return (
    currentSignature === undefined || entry.configSignature === currentSignature
  );
}
