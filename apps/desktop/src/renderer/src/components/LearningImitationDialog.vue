<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  watch
} from "vue";
import {
  LEARNING_IMITATION_MAX_DOCUMENTS,
  LEARNING_IMITATION_STAGE_DESCRIPTIONS,
  LEARNING_IMITATION_STAGE_IDS,
  LEARNING_IMITATION_STAGE_LABELS,
  learningImitationStageHasResult,
  type CatalogLibrary,
  type CatalogSnapshot,
  type LearningImitationDocument,
  type LearningImitationStageId,
  type LearningMaterialStageId,
  type MaterialKind,
  type MaterialStageId,
  type ModelConfig,
  type SkillKind,
  type SkillStageId
} from "@deepwrite/contracts";
import { uiMessage } from "../ui-feedback";
import {
  LEARNING_IMITATION_PRESET_PROMPTS,
  type LearningImitationController,
  type LearningImitationRunStatus
} from "../composables/useLearningImitation";
import {
  LEARNING_DOCUMENT_ACCEPT,
  LEARNING_DOCUMENT_SUPPORTED_LABEL,
  readLearningDocumentFile
} from "../utils/learningDocumentFiles";

const props = withDefaults(
  defineProps<{
    open: boolean;
    controller: LearningImitationController;
    models?: readonly ModelConfig[];
    catalogSnapshot?: CatalogSnapshot | null;
  }>(),
  {
    models: () => [],
    catalogSnapshot: null
  }
);

const emit = defineEmits<{
  close: [];
  refreshCatalog: [];
}>();

type LearningMaterialKind = Extract<
  MaterialKind,
  "character" | "gimmick" | "plot" | "draft"
>;
type LearningSkillKind = Extract<SkillKind, "plot" | "style">;
type PersistMode = "append" | "overwrite";

const CREATE_LIBRARY_VALUE = "__create_learning_library__";

interface MaterialResultField {
  id: LearningMaterialStageId;
  label: string;
  kind: LearningMaterialKind;
}

type PersistArtifact =
  | {
      domain: "material";
      libraryId: string;
      stageId: MaterialStageId;
      title: string;
      content: string;
    }
  | {
      domain: "skill";
      libraryId: string;
      stageId: SkillStageId;
      title: string;
      content: string;
    };

const MATERIAL_RESULT_FIELDS: readonly MaterialResultField[] = [
  { id: "gimmick", label: "梗", kind: "gimmick" },
  { id: "character", label: "人设", kind: "character" },
  { id: "pacing", label: "剧情设计", kind: "plot" },
  { id: "intro", label: "导语设计", kind: "plot" },
  { id: "plot_refine", label: "剧情细化", kind: "plot" },
  { id: "draft_excerpt", label: "优秀正文片段", kind: "draft" }
];

const LEARNING_MATERIAL_KINDS: readonly LearningMaterialKind[] = [
  "character",
  "gimmick",
  "plot",
  "draft"
];

const MATERIAL_KIND_LABELS: Record<LearningMaterialKind, string> = {
  character: "人设素材库",
  gimmick: "梗素材库",
  plot: "剧情素材库",
  draft: "正文素材库"
};

const SKILL_KIND_LABELS: Record<LearningSkillKind, string> = {
  plot: "剧情技能库",
  style: "文风技能库"
};

const PRESET_DETAILS: Record<LearningImitationStageId, string> = {
  material_split: "人设、梗、导语、剧情、正文片段",
  plot_learning: "结构、冲突、转折、节奏",
  style_learning: "句式、对白、情绪、收束"
};

const PRESET_LABELS: Record<LearningImitationStageId, string> = {
  material_split: "一键拆素材",
  plot_learning: "一键学习剧情设计",
  style_learning: "一键文风学习"
};

const PLOT_DESIGN_SKILL_PREFIX = `---
name: 剧情设计
description: 用户想要进行剧情设计时，加载此技能
---

1. 根据用户需求读取素材相关内容
2. 按照剧情设计技能思路进行剧情设计
3. 将设计结果写入剧情设计内容`;

const PLOT_REFINE_SKILL_PREFIX = `---
name: 剧情细化
description: 用户想要进行剧情细化时，加载此技能
---

1. 读取相关素材、剧情设计和导语设计
2. 按照剧情细化技能对剧情设计进行细化
3. 将细化结果写入剧情细化内容`;

const SECTION_WRITER_SKILL_PREFIX = `---
name: 分节写手技能
description: 用户进行小节编写时，加载此技能
---

读取大纲和正文相关片段，理解本节剧情要求；一次只写一节，并按字数要求和剧情点控制篇幅。`;

const fileInput = ref<HTMLInputElement | null>(null);
const chatLog = ref<HTMLElement | null>(null);
const processingFiles = ref(false);
const activeStage = ref<LearningImitationStageId>("material_split");
const customInputMode = ref(false);
const customPrompt = ref("");
const saveDialogOpen = ref(false);
const newSessionConfirmOpen = ref(false);
const saving = ref(false);

const selectedMaterialLibraryIds = reactive<Record<LearningMaterialKind, string>>({
  character: "",
  gimmick: "",
  plot: "",
  draft: ""
});
const selectedSkillLibraryIds = reactive<Record<LearningSkillKind, string>>({
  plot: "",
  style: ""
});
const newMaterialLibraryNames = reactive<Record<LearningMaterialKind, string>>({
  character: `学习仿写-人设素材 ${new Date().toLocaleDateString("zh-CN")}`,
  gimmick: `学习仿写-梗素材 ${new Date().toLocaleDateString("zh-CN")}`,
  plot: `学习仿写-剧情素材 ${new Date().toLocaleDateString("zh-CN")}`,
  draft: `学习仿写-正文素材 ${new Date().toLocaleDateString("zh-CN")}`
});
const newSkillLibraryNames = reactive<Record<LearningSkillKind, string>>({
  plot: `学习仿写-剧情技能 ${new Date().toLocaleDateString("zh-CN")}`,
  style: `学习仿写-文风技能 ${new Date().toLocaleDateString("zh-CN")}`
});
const transientLibraries = new Map<string, CatalogLibrary>();
const backgroundPersistRunIds = new Set<string>();

const documents = computed(() => props.controller.documents.value);
const result = computed(() => props.controller.result.value);
const messages = computed(() => props.controller.messages.value);
const tools = computed(() => props.controller.tools.value);
const status = computed(() => props.controller.status.value);
const isBusy = computed(() => props.controller.isBusy.value);
const runningStage = computed(() => props.controller.runningStage.value);
const selectedModelId = computed({
  get: () => props.controller.selectedModelId.value,
  set: (value: string) => {
    props.controller.selectedModelId.value = value;
  }
});
const materialLibraries = computed(
  () => props.catalogSnapshot?.materials ?? []
);
const skillLibraries = computed(() => props.catalogSnapshot?.skills ?? []);
const activeHasResult = computed(() =>
  learningImitationStageHasResult(activeStage.value, result.value)
);
const previewLocked = computed(
  () => saving.value || runningStage.value === activeStage.value
);

const populatedMaterialKinds = computed(() => {
  const kinds = new Set<LearningMaterialKind>();
  for (const field of MATERIAL_RESULT_FIELDS) {
    if (result.value.material_split[field.id].trim()) kinds.add(field.kind);
  }
  return LEARNING_MATERIAL_KINDS.filter((kind) => kinds.has(kind));
});

const statusLabel = computed(() => {
  const labels: Record<LearningImitationRunStatus, string> = {
    idle: "等待开始",
    starting: "正在启动",
    running: "后台运行中",
    stopping: "正在停止",
    completed: "本轮已完成",
    stopped: "本轮已停止",
    error: "本轮运行失败"
  };
  return labels[status.value];
});

const statusTone = computed(() => {
  if (status.value === "running" || status.value === "starting") return "running";
  if (status.value === "completed") return "success";
  if (status.value === "error") return "error";
  return "neutral";
});

function inputValue(event: Event): string {
  return (event.target as HTMLInputElement | HTMLTextAreaElement).value;
}

function materialCandidates(kind: LearningMaterialKind) {
  return materialLibraries.value.filter(
    (library) =>
      library.materialKind === kind || library.materialKind === "mixed"
  );
}

function findMaterialLibrary(libraryId: string) {
  const persisted = materialLibraries.value.find(
    (library) => library.id === libraryId
  );
  if (persisted) return persisted;
  const transient = transientLibraries.get(libraryId);
  return transient && "materialKind" in transient ? transient : undefined;
}

function skillCandidates(kind: LearningSkillKind) {
  return skillLibraries.value.filter(
    (library) => library.skillKind === kind && !library.isBuiltin
  );
}

function findSkillLibrary(libraryId: string) {
  const persisted = skillLibraries.value.find((library) => library.id === libraryId);
  if (persisted) return persisted;
  const transient = transientLibraries.get(libraryId);
  return transient && "skillKind" in transient ? transient : undefined;
}

function resetInvalidTargets(): void {
  for (const kind of LEARNING_MATERIAL_KINDS) {
    if (
      selectedMaterialLibraryIds[kind] &&
      selectedMaterialLibraryIds[kind] !== CREATE_LIBRARY_VALUE &&
      !materialCandidates(kind).some(
        (library) => library.id === selectedMaterialLibraryIds[kind]
      )
    ) {
      selectedMaterialLibraryIds[kind] = "";
    }
  }
  for (const kind of ["plot", "style"] as const) {
    if (
      selectedSkillLibraryIds[kind] &&
      selectedSkillLibraryIds[kind] !== CREATE_LIBRARY_VALUE &&
      !skillCandidates(kind).some(
        (library) => library.id === selectedSkillLibraryIds[kind]
      )
    ) {
      selectedSkillLibraryIds[kind] = "";
    }
  }
}

function requestClose(): void {
  saveDialogOpen.value = false;
  newSessionConfirmOpen.value = false;
  emit("close");
}

function openFilePicker(): void {
  fileInput.value?.click();
}

async function handleFiles(files: readonly File[]): Promise<void> {
  if (!files.length) return;
  if (isBusy.value) {
    uiMessage.warning("学习任务运行中，暂不能修改本轮样本文档。");
    return;
  }
  if (documents.value.length + files.length > LEARNING_IMITATION_MAX_DOCUMENTS) {
    uiMessage.warning(`最多上传 ${LEARNING_IMITATION_MAX_DOCUMENTS} 个样本文档。`);
    return;
  }
  processingFiles.value = true;
  const nextDocuments: LearningImitationDocument[] = [];
  try {
    for (const file of files) {
      try {
        const { document, warning } = await readLearningDocumentFile(file);
        nextDocuments.push(document);
        if (warning) uiMessage.warning(warning);
      } catch (cause: unknown) {
        uiMessage.error(
          cause instanceof Error ? cause.message : `读取“${file.name}”失败。`
        );
      }
    }
    if (!nextDocuments.length) return;
    if (!props.controller.addDocuments(nextDocuments)) {
      uiMessage.error(props.controller.error.value ?? "添加样本文档失败。");
      return;
    }
    uiMessage.success(
      `已加入 ${nextDocuments.length} 个样本文档，共 ${documents.value.length} 个。`
    );
  } finally {
    processingFiles.value = false;
  }
}

function onFileChange(event: Event): void {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  input.value = "";
  void handleFiles(files);
}

function removeDocument(documentId: string): void {
  if (!props.controller.removeDocument(documentId)) {
    uiMessage.warning(props.controller.error.value ?? "当前不能移除样本文档。");
  }
}

function updateMaterialResult(
  stageId: LearningMaterialStageId,
  value: string
): void {
  props.controller.setResult({
    ...result.value,
    material_split: {
      ...result.value.material_split,
      [stageId]: value
    }
  });
}

function updatePlotResult(
  key: "plotDesignSkill" | "plotRefineSkill",
  value: string
): void {
  props.controller.setResult({
    ...result.value,
    plot_learning: {
      ...result.value.plot_learning,
      [key]: value
    }
  });
}

function updateStyleTitle(value: string): void {
  props.controller.setResult({
    ...result.value,
    style_learning: { ...result.value.style_learning, title: value }
  });
}

function updateStyleBody(value: string): void {
  props.controller.setResult({
    ...result.value,
    style_learning: { ...result.value.style_learning, body: value }
  });
}

async function runStage(
  stageId: LearningImitationStageId,
  prompt = LEARNING_IMITATION_PRESET_PROMPTS[stageId]
): Promise<void> {
  if (processingFiles.value) {
    uiMessage.info("文档仍在解析，请稍候。");
    return;
  }
  activeStage.value = stageId;
  const started = await props.controller.start(stageId, {
    prompt,
    ...(selectedModelId.value ? { modelId: selectedModelId.value } : {})
  });
  if (!started) {
    uiMessage.error(props.controller.error.value ?? "学习任务启动失败。");
  }
}

function sendCustomPrompt(): void {
  const prompt = customPrompt.value.trim();
  if (!prompt) {
    uiMessage.warning("请输入想让学习智能体执行的任务。");
    return;
  }
  void runStage(activeStage.value, prompt).then(() => {
    if (props.controller.status.value !== "error") customPrompt.value = "";
  });
}

async function stopLearning(): Promise<void> {
  if (!(await props.controller.stop())) {
    uiMessage.error(props.controller.error.value ?? "停止学习任务失败。");
  }
}

function wrapSkillBody(prefix: string, body: string): string {
  const normalized = body.trim();
  return normalized ? `${prefix}\n\n${normalized}` : "";
}

function validateTargetSelections(stageId: LearningImitationStageId): void {
  if (stageId === "material_split") {
    for (const kind of populatedMaterialKinds.value) {
      const target = selectedMaterialLibraryIds[kind];
      if (!target) throw new Error(`请选择${MATERIAL_KIND_LABELS[kind]}。`);
      if (
        target === CREATE_LIBRARY_VALUE &&
        !newMaterialLibraryNames[kind].trim()
      ) {
        throw new Error(`请填写新建${MATERIAL_KIND_LABELS[kind]}的名称。`);
      }
    }
    return;
  }
  const kind: LearningSkillKind =
    stageId === "plot_learning" ? "plot" : "style";
  const target = selectedSkillLibraryIds[kind];
  if (!target) throw new Error(`请选择${SKILL_KIND_LABELS[kind]}。`);
  if (target === CREATE_LIBRARY_VALUE && !newSkillLibraryNames[kind].trim()) {
    throw new Error(`请填写新建${SKILL_KIND_LABELS[kind]}的名称。`);
  }
}

function hasConfiguredTargets(stageId: LearningImitationStageId): boolean {
  if (!learningImitationStageHasResult(stageId, result.value)) return false;
  try {
    validateTargetSelections(stageId);
    return true;
  } catch {
    return false;
  }
}

function buildPersistArtifacts(
  stageId: LearningImitationStageId = activeStage.value
): PersistArtifact[] {
  validateTargetSelections(stageId);
  if (stageId === "material_split") {
    return MATERIAL_RESULT_FIELDS.flatMap((field) => {
      const content = result.value.material_split[field.id].trim();
      if (!content) return [];
      const libraryId = selectedMaterialLibraryIds[field.kind];
      if (!libraryId) {
        throw new Error(`请选择${MATERIAL_KIND_LABELS[field.kind]}。`);
      }
      return [
        {
          domain: "material" as const,
          libraryId,
          stageId: field.id,
          title: `学习仿写 · ${field.label}`,
          content
        }
      ];
    });
  }
  if (stageId === "plot_learning") {
    const libraryId = selectedSkillLibraryIds.plot;
    if (!libraryId) throw new Error(`请选择${SKILL_KIND_LABELS.plot}。`);
    const artifacts: PersistArtifact[] = [
      {
        domain: "skill",
        libraryId,
        stageId: "plot_design",
        title: "剧情设计",
        content: wrapSkillBody(
          PLOT_DESIGN_SKILL_PREFIX,
          result.value.plot_learning.plotDesignSkill
        )
      },
      {
        domain: "skill",
        libraryId,
        stageId: "plot_design",
        title: "剧情细化",
        content: wrapSkillBody(
          PLOT_REFINE_SKILL_PREFIX,
          result.value.plot_learning.plotRefineSkill
        )
      }
    ];
    return artifacts.filter((artifact) => artifact.content.trim());
  }
  const libraryId = selectedSkillLibraryIds.style;
  if (!libraryId) throw new Error(`请选择${SKILL_KIND_LABELS.style}。`);
  const body = wrapSkillBody(
    SECTION_WRITER_SKILL_PREFIX,
    result.value.style_learning.body
  );
  return body
    ? [
        {
          domain: "skill",
          libraryId,
          stageId: "expert_section_writer",
          title: result.value.style_learning.title.trim() || "分节写手技能",
          content: body
        }
      ]
    : [];
}

async function resolveNewTargetLibraries(
  stageId: LearningImitationStageId
): Promise<{ proceed: boolean; mutated: boolean }> {
  const api = window.deepwrite;
  if (!api) return { proceed: false, mutated: false };
  let mutated = false;
  if (stageId === "material_split") {
    for (const kind of populatedMaterialKinds.value) {
      if (selectedMaterialLibraryIds[kind] !== CREATE_LIBRARY_VALUE) continue;
      const created = await api.catalog.createLibrary({
        domain: "material",
        name: newMaterialLibraryNames[kind].trim(),
        materialKind: kind
      });
      if (!created) {
        if (mutated) emit("refreshCatalog");
        uiMessage.info("已取消新建资料库，本次落盘未继续。");
        return { proceed: false, mutated };
      }
      transientLibraries.set(created.id, created);
      selectedMaterialLibraryIds[kind] = created.id;
      mutated = true;
    }
  } else {
    const kind: LearningSkillKind =
      stageId === "plot_learning" ? "plot" : "style";
    if (selectedSkillLibraryIds[kind] === CREATE_LIBRARY_VALUE) {
      const created = await api.catalog.createLibrary({
        domain: "skill",
        name: newSkillLibraryNames[kind].trim(),
        skillKind: kind
      });
      if (!created) {
        uiMessage.info("已取消新建资料库，本次落盘未继续。");
        return { proceed: false, mutated: false };
      }
      transientLibraries.set(created.id, created);
      selectedSkillLibraryIds[kind] = created.id;
      mutated = true;
    }
  }
  if (mutated) emit("refreshCatalog");
  return { proceed: true, mutated };
}

function prepareSave(): void {
  if (!activeHasResult.value) {
    uiMessage.warning("当前阶段预览为空，暂无可落盘内容。");
    return;
  }
  try {
    if (!buildPersistArtifacts(activeStage.value).length) {
      uiMessage.warning("当前阶段预览为空，暂无可落盘内容。");
      return;
    }
    saveDialogOpen.value = true;
  } catch (cause: unknown) {
    uiMessage.warning(
      cause instanceof Error ? cause.message : "请先选择匹配的目标资料库。"
    );
  }
}

function appendText(current: string, incoming: string): string {
  const base = current.trim();
  const addition = incoming.trim();
  return base && addition ? `${base}\n\n${addition}` : base || addition;
}

async function persistStage(
  mode: PersistMode,
  stageId: LearningImitationStageId = activeStage.value,
  background = false
): Promise<void> {
  if (!window.deepwrite) {
    uiMessage.warning("浏览器预览不能写入本地资料库，请使用桌面客户端。");
    return;
  }
  try {
    validateTargetSelections(stageId);
  } catch (cause: unknown) {
    uiMessage.warning(
      cause instanceof Error ? cause.message : "请先选择匹配的目标资料库。"
    );
    return;
  }
  if (!learningImitationStageHasResult(stageId, result.value)) {
    uiMessage.warning("当前阶段预览为空，暂无可落盘内容。");
    return;
  }

  saving.value = true;
  let mutated = false;
  try {
    const targetResolution = await resolveNewTargetLibraries(stageId);
    mutated = targetResolution.mutated;
    if (!targetResolution.proceed) return;
    const artifacts = buildPersistArtifacts(stageId);
    if (!artifacts.length) {
      uiMessage.warning("当前阶段预览为空，暂无可落盘内容。");
      return;
    }
    const revisions = new Map<string, number | undefined>();
    for (const artifact of artifacts) {
      const key = `${artifact.domain}:${artifact.libraryId}`;
      if (!revisions.has(key)) {
        const library =
          artifact.domain === "material"
            ? findMaterialLibrary(artifact.libraryId)
            : findSkillLibrary(artifact.libraryId);
        revisions.set(key, library?.projectRevision);
      }
      const projectRevision = revisions.get(key);

      if (artifact.domain === "material") {
        const library = findMaterialLibrary(artifact.libraryId);
        if (!library) throw new Error("目标素材库已不可用，请刷新后重试。");
        const existing = library.entries.find(
          (entry) => entry.stageId === artifact.stageId
        );
        if (existing) {
          await window.deepwrite.catalog.saveLibraryEntry({
            domain: "material",
            libraryId: artifact.libraryId,
            entryId: existing.id,
            content:
              mode === "append"
                ? appendText(existing.body, artifact.content)
                : artifact.content,
            ...(projectRevision === undefined ? {} : { baseProjectRevision: projectRevision })
          });
        } else {
          await window.deepwrite.catalog.createLibraryEntry({
            domain: "material",
            libraryId: artifact.libraryId,
            title: artifact.title,
            content: artifact.content,
            stageId: artifact.stageId,
            ...(projectRevision === undefined ? {} : { baseProjectRevision: projectRevision })
          });
        }
      } else {
        const library = findSkillLibrary(artifact.libraryId);
        if (!library) throw new Error("目标技能库已不可用，请刷新后重试。");
        const existing = library.entries.find(
          (entry) =>
            entry.stageId === artifact.stageId &&
            entry.title.trim() === artifact.title.trim()
        );
        if (existing) {
          await window.deepwrite.catalog.saveLibraryEntry({
            domain: "skill",
            libraryId: artifact.libraryId,
            entryId: existing.id,
            content:
              mode === "append"
                ? appendText(existing.body, artifact.content)
                : artifact.content,
            ...(projectRevision === undefined ? {} : { baseProjectRevision: projectRevision })
          });
        } else {
          await window.deepwrite.catalog.createLibraryEntry({
            domain: "skill",
            libraryId: artifact.libraryId,
            title: artifact.title,
            content: artifact.content,
            stageId: artifact.stageId,
            ...(projectRevision === undefined ? {} : { baseProjectRevision: projectRevision })
          });
        }
      }
      mutated = true;
      if (projectRevision !== undefined) revisions.set(key, projectRevision + 1);
    }
    saveDialogOpen.value = false;
    emit("refreshCatalog");
    uiMessage.success(
      background
        ? `「${LEARNING_IMITATION_STAGE_LABELS[stageId]}」已在后台完成并自动覆盖落盘。`
        : `「${LEARNING_IMITATION_STAGE_LABELS[stageId]}」已${
            mode === "append" ? "追加" : "覆盖"
          }到本地资料库。`
    );
  } catch (cause: unknown) {
    if (mutated) emit("refreshCatalog");
    uiMessage.error(cause instanceof Error ? cause.message : "学习结果落盘失败。");
  } finally {
    saving.value = false;
  }
}

function confirmNewSession(): void {
  if (!props.controller.newSession()) {
    uiMessage.warning(props.controller.error.value ?? "当前不能新建学习会话。");
    return;
  }
  activeStage.value = "material_split";
  customPrompt.value = "";
  customInputMode.value = false;
  for (const kind of LEARNING_MATERIAL_KINDS) {
    selectedMaterialLibraryIds[kind] = "";
  }
  selectedSkillLibraryIds.plot = "";
  selectedSkillLibraryIds.style = "";
  newSessionConfirmOpen.value = false;
  uiMessage.success("已新建学习仿写会话。");
}

function toolDisplayName(name: string): string {
  const labels: Record<string, string> = {
    list_learning_documents: "读取样本目录",
    read_learning_document: "读取样本文档",
    write_learning_result: "写入学习预览"
  };
  return labels[name] ?? name;
}

function onKeyDown(event: KeyboardEvent): void {
  if (!props.open || event.key !== "Escape") return;
  event.preventDefault();
  if (saveDialogOpen.value) {
    saveDialogOpen.value = false;
  } else if (newSessionConfirmOpen.value) {
    newSessionConfirmOpen.value = false;
  } else {
    requestClose();
  }
}

watch(
  () => props.models,
  (models) => props.controller.setConfiguredModels(models),
  { immediate: true, deep: true }
);

watch(
  () => props.catalogSnapshot,
  () => resetInvalidTargets(),
  { immediate: true }
);

watch(
  () => props.open,
  (open) => {
    if (open && runningStage.value) activeStage.value = runningStage.value;
  }
);

watch(status, (next, previous) => {
  if (next === previous) return;
  if (next === "completed") {
    const runId = props.controller.lastCompletedRunId.value;
    const stageId = props.controller.lastCompletedStage.value;
    if (!props.open && runId && stageId && !backgroundPersistRunIds.has(runId)) {
      backgroundPersistRunIds.add(runId);
      activeStage.value = stageId;
      if (hasConfiguredTargets(stageId)) {
        void persistStage("overwrite", stageId, true);
      } else {
        uiMessage.success(
          "后台完成，预览已保留；重新打开后选择目标确认落盘。"
        );
      }
    } else {
      uiMessage.success("学习仿写已完成，结果预览已保留。");
    }
  } else if (next === "stopped") {
    uiMessage.info("学习仿写已停止，已生成的预览仍会保留。");
  } else if (next === "error") {
    uiMessage.error(props.controller.error.value ?? "学习仿写运行失败。");
  }
});

watch(
  () => props.controller.error.value,
  (next, previous) => {
    if (next && next !== previous && isBusy.value) uiMessage.error(next);
  }
);

watch(
  () => messages.value.map((message) => message.updatedAt).join("|"),
  () => {
    void nextTick(() => {
      if (chatLog.value) chatLog.value.scrollTop = chatLog.value.scrollHeight;
    });
  }
);

onMounted(() => document.addEventListener("keydown", onKeyDown));
onBeforeUnmount(() => document.removeEventListener("keydown", onKeyDown));
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="learning-backdrop" @mousedown.self="requestClose">
      <section
        class="learning-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="learning-dialog-title"
      >
        <header class="learning-head">
          <div class="learning-title-block">
            <span class="learning-eyebrow">DeepWrite · 学习中心</span>
            <div class="learning-title-row">
              <h2 id="learning-dialog-title">学习仿写</h2>
              <span class="learning-status" :data-tone="statusTone">
                <i aria-hidden="true"></i>{{ statusLabel }}
              </span>
            </div>
            <p>上传 1-5 篇小说正文，拆出可复用素材，沉淀剧情方法与文风技能。</p>
          </div>
          <div class="learning-head-actions">
            <button
              type="button"
              class="learning-quiet-button"
              :disabled="isBusy"
              @click="newSessionConfirmOpen = true"
            >
              新建学习
            </button>
            <button
              type="button"
              class="learning-close"
              aria-label="关闭学习仿写，任务将在后台继续"
              title="关闭弹窗；运行中的任务会在后台继续"
              @click="requestClose"
            >
              ×
            </button>
          </div>
        </header>

        <section class="learning-source-bar" aria-label="样本文档">
          <div class="learning-upload-copy">
            <strong>正文样本</strong>
            <span>{{ documents.length }}/{{ LEARNING_IMITATION_MAX_DOCUMENTS }} 个文档 · 支持 {{ LEARNING_DOCUMENT_SUPPORTED_LABEL }}</span>
          </div>
          <input
            ref="fileInput"
            class="learning-file-input"
            type="file"
            multiple
            :accept="LEARNING_DOCUMENT_ACCEPT"
            @change="onFileChange"
          />
          <button
            type="button"
            class="learning-secondary-button"
            :disabled="processingFiles || isBusy || documents.length >= LEARNING_IMITATION_MAX_DOCUMENTS"
            @click="openFilePicker"
          >
            {{ processingFiles ? "解析中…" : "+ 上传正文" }}
          </button>
          <ul v-if="documents.length" class="learning-document-list">
            <li v-for="item in documents" :key="item.id">
              <span :title="item.name">{{ item.name }}</span>
              <small>{{ item.charCount.toLocaleString("zh-CN") }} 字</small>
              <button
                type="button"
                :disabled="isBusy"
                :aria-label="`移除 ${item.name}`"
                @click="removeDocument(item.id)"
              >
                ×
              </button>
            </li>
          </ul>
          <span v-else class="learning-document-empty">尚未上传正文</span>
        </section>

        <nav class="learning-tabs" aria-label="学习仿写阶段">
          <button
            v-for="(stageId, index) in LEARNING_IMITATION_STAGE_IDS"
            :key="stageId"
            type="button"
            :class="{ 'is-active': activeStage === stageId }"
            @click="activeStage = stageId"
          >
            <span>{{ index + 1 }}</span>
            <strong>{{ LEARNING_IMITATION_STAGE_LABELS[stageId] }}</strong>
            <i
              v-if="learningImitationStageHasResult(stageId, result)"
              aria-label="已有结果"
            ></i>
          </button>
        </nav>

        <div class="learning-body">
          <main class="learning-result-pane">
            <header class="learning-panel-head">
              <div>
                <span>结果预览</span>
                <h3>{{ LEARNING_IMITATION_STAGE_LABELS[activeStage] }}</h3>
                <p>{{ LEARNING_IMITATION_STAGE_DESCRIPTIONS[activeStage] }}</p>
              </div>
              <button
                type="button"
                class="learning-primary-button"
                :disabled="!activeHasResult || saving"
                @click="prepareSave"
              >
                {{ saving ? "落盘中…" : "确认落盘" }}
              </button>
            </header>

            <section v-if="activeStage === 'material_split'" class="learning-target-strip">
              <label v-for="kind in LEARNING_MATERIAL_KINDS" :key="kind">
                <span>{{ MATERIAL_KIND_LABELS[kind] }}</span>
                <select v-model="selectedMaterialLibraryIds[kind]" :disabled="saving">
                  <option value="">请选择目标库</option>
                  <option :value="CREATE_LIBRARY_VALUE">＋ 新建资料库…</option>
                  <option
                    v-for="library in materialCandidates(kind)"
                    :key="library.id"
                    :value="library.id"
                  >
                    {{ library.title }} · {{ library.materialType }}
                  </option>
                </select>
                <input
                  v-if="selectedMaterialLibraryIds[kind] === CREATE_LIBRARY_VALUE"
                  v-model="newMaterialLibraryNames[kind]"
                  class="learning-new-library-name"
                  maxlength="80"
                  :aria-label="`新建${MATERIAL_KIND_LABELS[kind]}名称`"
                  placeholder="输入新资料库名称"
                />
              </label>
              <p v-if="!populatedMaterialKinds.length">AI 生成结果后，会按分类选择对应素材库。</p>
            </section>
            <section v-else class="learning-target-strip is-single">
              <label>
                <span>{{ activeStage === "plot_learning" ? SKILL_KIND_LABELS.plot : SKILL_KIND_LABELS.style }}</span>
                <template v-if="activeStage === 'plot_learning'">
                  <select v-model="selectedSkillLibraryIds.plot" :disabled="saving">
                    <option value="">请选择目标库</option>
                    <option :value="CREATE_LIBRARY_VALUE">＋ 新建资料库…</option>
                    <option v-for="library in skillCandidates('plot')" :key="library.id" :value="library.id">
                      {{ library.title }} · {{ library.skillType }}
                    </option>
                  </select>
                  <input
                    v-if="selectedSkillLibraryIds.plot === CREATE_LIBRARY_VALUE"
                    v-model="newSkillLibraryNames.plot"
                    class="learning-new-library-name"
                    maxlength="80"
                    aria-label="新建剧情技能库名称"
                    placeholder="输入新资料库名称"
                  />
                </template>
                <template v-else>
                  <select v-model="selectedSkillLibraryIds.style" :disabled="saving">
                    <option value="">请选择目标库</option>
                    <option :value="CREATE_LIBRARY_VALUE">＋ 新建资料库…</option>
                    <option v-for="library in skillCandidates('style')" :key="library.id" :value="library.id">
                      {{ library.title }} · {{ library.skillType }}
                    </option>
                  </select>
                  <input
                    v-if="selectedSkillLibraryIds.style === CREATE_LIBRARY_VALUE"
                    v-model="newSkillLibraryNames.style"
                    class="learning-new-library-name"
                    maxlength="80"
                    aria-label="新建文风技能库名称"
                    placeholder="输入新资料库名称"
                  />
                </template>
              </label>
              <p>预览可手动修订；提示词请在“设置 → 学习仿写设置”中维护。</p>
            </section>

            <div v-if="activeStage === 'material_split'" class="learning-material-grid">
              <label
                v-for="field in MATERIAL_RESULT_FIELDS"
                :key="field.id"
                class="learning-result-field"
              >
                <span>{{ field.label }}</span>
                <textarea
                  :value="result.material_split[field.id]"
                  maxlength="200000"
                  :disabled="previewLocked"
                  placeholder="等待 AI 写入，或在任务结束后手动编辑"
                  @input="updateMaterialResult(field.id, inputValue($event))"
                ></textarea>
              </label>
            </div>
            <div v-else-if="activeStage === 'plot_learning'" class="learning-result-stack">
              <label class="learning-result-field">
                <span>剧情设计技能</span>
                <textarea
                  :value="result.plot_learning.plotDesignSkill"
                  maxlength="200000"
                  :disabled="previewLocked"
                  placeholder="等待 AI 归纳剧情设计方法"
                  @input="updatePlotResult('plotDesignSkill', inputValue($event))"
                ></textarea>
              </label>
              <label class="learning-result-field">
                <span>剧情细化技能</span>
                <textarea
                  :value="result.plot_learning.plotRefineSkill"
                  maxlength="200000"
                  :disabled="previewLocked"
                  placeholder="等待 AI 归纳剧情细化方法"
                  @input="updatePlotResult('plotRefineSkill', inputValue($event))"
                ></textarea>
              </label>
            </div>
            <div v-else class="learning-result-stack is-style">
              <label class="learning-title-field">
                <span>技能标题</span>
                <input
                  :value="result.style_learning.title"
                  maxlength="256"
                  :disabled="previewLocked"
                  @input="updateStyleTitle(inputValue($event))"
                />
              </label>
              <label class="learning-result-field">
                <span>分节写手技能</span>
                <textarea
                  :value="result.style_learning.body"
                  maxlength="200000"
                  :disabled="previewLocked"
                  placeholder="等待 AI 归纳句式、对白、情绪与收束规则"
                  @input="updateStyleBody(inputValue($event))"
                ></textarea>
              </label>
            </div>
          </main>

          <aside class="learning-agent-pane" aria-label="学习仿写智能体">
            <header class="learning-agent-head">
              <div>
                <span class="learning-agent-mark">AI</span>
                <p><strong>学习智能体</strong><small>{{ runningStage ? `正在执行：${LEARNING_IMITATION_STAGE_LABELS[runningStage]}` : "共享同一学习会话" }}</small></p>
              </div>
              <select v-model="selectedModelId" aria-label="选择学习仿写模型" :disabled="isBusy">
                <option value="">请先配置并选择模型</option>
                <option v-for="model in models" :key="model.id" :value="model.id">
                  {{ model.label }}
                </option>
              </select>
            </header>

            <div class="learning-quick-actions" aria-label="一键学习任务">
              <button
                v-for="stageId in LEARNING_IMITATION_STAGE_IDS"
                :key="stageId"
                type="button"
                :class="{ 'is-current': activeStage === stageId }"
                :disabled="isBusy || processingFiles || documents.length === 0"
                @click="runStage(stageId)"
              >
                <span aria-hidden="true">{{ runningStage === stageId ? "···" : "✦" }}</span>
                <p><strong>{{ runningStage === stageId ? "运行中…" : PRESET_LABELS[stageId] }}</strong><small>{{ PRESET_DETAILS[stageId] }}</small></p>
              </button>
            </div>

            <div ref="chatLog" class="learning-chat-log" aria-live="polite">
              <div v-if="!messages.length" class="learning-chat-empty">
                <span>✦</span>
                <strong>准备好后选择一键任务</strong>
                <p>关闭弹窗不会中断运行；再次打开会继续显示同一轮进度。</p>
              </div>
              <article
                v-for="message in messages"
                :key="message.id"
                class="learning-chat-message"
                :class="`is-${message.role}`"
              >
                <small>{{ message.role === "user" ? "你" : "学习智能体" }} · {{ LEARNING_IMITATION_STAGE_LABELS[message.stageId] }}</small>
                <details v-if="message.thinking" class="learning-thinking">
                  <summary>查看思考过程</summary>
                  <p>{{ message.thinking }}</p>
                </details>
                <p>{{ message.content || (message.status === "streaming" ? "正在分析样本…" : "") }}</p>
              </article>
              <div v-if="tools.length" class="learning-tool-list">
                <div v-for="tool in tools" :key="`${tool.runId}:${tool.id}`">
                  <i :data-status="tool.status" aria-hidden="true"></i>
                  <span>{{ toolDisplayName(tool.name) }}</span>
                  <small>{{ tool.status === "completed" ? "完成" : tool.status === "error" ? "失败" : "执行中" }}</small>
                </div>
              </div>
            </div>

            <footer class="learning-agent-composer">
              <button
                type="button"
                class="learning-mode-toggle"
                :class="{ 'is-active': customInputMode }"
                :disabled="documents.length === 0"
                @click="customInputMode = !customInputMode"
              >
                {{ customInputMode ? "返回按钮模式" : "自己输入任务" }}
              </button>
              <div v-if="customInputMode" class="learning-custom-input">
                <textarea
                  v-model="customPrompt"
                  maxlength="20000"
                  :disabled="isBusy"
                  placeholder="例如：重点分析这些样本如何设计前三段钩子…"
                  @keydown.ctrl.enter.prevent="sendCustomPrompt"
                  @keydown.meta.enter.prevent="sendCustomPrompt"
                ></textarea>
                <button type="button" :disabled="isBusy || !customPrompt.trim()" @click="sendCustomPrompt">发送</button>
              </div>
              <div v-if="isBusy" class="learning-running-footer">
                <span>任务会持续在后台执行，关闭弹窗也不会中断。</span>
                <button type="button" @click="stopLearning">停止</button>
              </div>
            </footer>
          </aside>
        </div>
      </section>

      <div v-if="saveDialogOpen" class="learning-confirm-backdrop" @mousedown.self="saveDialogOpen = false">
        <section class="learning-confirm-dialog" role="dialog" aria-modal="true" aria-label="确认学习结果落盘">
          <header><div><span>写入本地资料库</span><h3>确认落盘</h3></div><button type="button" :disabled="saving" @click="saveDialogOpen = false">×</button></header>
          <p>将“{{ LEARNING_IMITATION_STAGE_LABELS[activeStage] }}”当前预览写入已选择的目标库。</p>
          <div class="learning-save-summary">
            <span v-if="activeStage === 'material_split'">按人设、梗、剧情和正文分类匹配已有栏目。</span>
            <span v-else>按阶段和技能名称匹配已有条目。</span>
          </div>
          <p class="learning-save-note">追加会把新内容接在同栏目末尾；覆盖会替换同栏目的旧内容。尚无匹配栏目时，两种方式都会新建条目。</p>
          <footer>
            <button type="button" class="learning-secondary-button" :disabled="saving" @click="saveDialogOpen = false">取消</button>
            <button type="button" class="learning-secondary-button" :disabled="saving" @click="persistStage('append')">追加落盘</button>
            <button type="button" class="learning-primary-button" :disabled="saving" @click="persistStage('overwrite')">覆盖落盘</button>
          </footer>
        </section>
      </div>

      <div v-if="newSessionConfirmOpen" class="learning-confirm-backdrop" @mousedown.self="newSessionConfirmOpen = false">
        <section class="learning-confirm-dialog is-compact" role="alertdialog" aria-modal="true" aria-label="新建学习仿写会话">
          <header><div><span>新建学习</span><h3>清空当前样本与预览？</h3></div><button type="button" @click="newSessionConfirmOpen = false">×</button></header>
          <p>当前文档、三阶段结果和聊天记录会被清空。已落盘到资料库的内容不会受影响。</p>
          <footer>
            <button type="button" class="learning-secondary-button" @click="newSessionConfirmOpen = false">取消</button>
            <button type="button" class="learning-primary-button is-danger" @click="confirmNewSession">确认新建</button>
          </footer>
        </section>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.learning-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1200;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgb(15 23 42 / 52%);
  backdrop-filter: blur(10px);
}

.learning-dialog {
  width: min(1380px, calc(100vw - 48px));
  height: min(880px, calc(100vh - 48px));
  min-height: 620px;
  overflow: hidden;
  display: grid;
  grid-template-rows: auto auto auto minmax(0, 1fr);
  color: var(--text-primary);
  background: var(--surface-main);
  border: 1px solid var(--theme-line-soft);
  border-radius: 22px;
  box-shadow: 0 28px 80px rgb(15 23 42 / 30%);
}

.learning-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
  padding: 20px 24px 17px;
  background: linear-gradient(
    125deg,
    var(--surface-raised) 0%,
    color-mix(in srgb, var(--accent) 7%, var(--surface-raised)) 54%,
    color-mix(in srgb, var(--accent) 4%, var(--surface-main)) 100%
  );
  border-bottom: 1px solid var(--theme-line-soft);
}

.learning-title-block { min-width: 0; }
.learning-eyebrow,
.learning-panel-head > div > span,
.learning-confirm-dialog header span {
  color: var(--accent);
  font-size: 0.785714rem;
  font-weight: 750;
  letter-spacing: .1em;
  text-transform: uppercase;
}

.learning-title-row { display: flex; align-items: center; gap: 12px; margin-top: 3px; }
.learning-title-row h2 { margin: 0; color: var(--text-primary); font-size: 1.785714rem; line-height: 1.15; }
.learning-title-block > p { margin: 6px 0 0; color: var(--text-secondary); font-size: 0.928571rem; }

.learning-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 9px;
  border-radius: 999px;
  color: var(--text-secondary);
  background: var(--surface-muted);
  font-size: 0.785714rem;
  font-weight: 650;
}
.learning-status i { width: 6px; height: 6px; border-radius: 50%; background: var(--text-tertiary); }
.learning-status[data-tone="running"] { color: var(--accent); background: var(--accent-soft); }
.learning-status[data-tone="running"] i { background: var(--accent); box-shadow: 0 0 0 4px color-mix(in srgb, var(--accent) 13%, transparent); }
.learning-status[data-tone="success"] { color: color-mix(in srgb, #2a9b6e 74%, var(--text-primary)); background: color-mix(in srgb, #2a9b6e 15%, var(--surface-raised)); }
.learning-status[data-tone="success"] i { background: #2a9b6e; }
.learning-status[data-tone="error"] { color: color-mix(in srgb, #cf5363 74%, var(--text-primary)); background: color-mix(in srgb, #cf5363 15%, var(--surface-raised)); }
.learning-status[data-tone="error"] i { background: #cf5363; }

.learning-head-actions { display: flex; align-items: center; gap: 8px; }
button { font: inherit; }
.learning-close,
.learning-confirm-dialog header button {
  width: 34px;
  height: 34px;
  border: 0;
  border-radius: 10px;
  color: var(--text-secondary);
  background: transparent;
  font-size: 22px;
  cursor: pointer;
}
.learning-close:hover,
.learning-confirm-dialog header button:hover { color: var(--text-primary); background: var(--surface-hover); }

.learning-quiet-button,
.learning-secondary-button,
.learning-primary-button {
  min-height: 34px;
  padding: 0 14px;
  border-radius: 9px;
  font-size: 0.857143rem;
  font-weight: 700;
  cursor: pointer;
}
.learning-quiet-button,
.learning-secondary-button { color: var(--text-secondary); background: var(--surface-raised); border: 1px solid var(--theme-line); }
.learning-quiet-button:hover,
.learning-secondary-button:hover { border-color: var(--accent); background: var(--surface-hover); }
.learning-primary-button { color: #fff; background: var(--accent); border: 1px solid var(--accent); box-shadow: 0 5px 14px color-mix(in srgb, var(--accent) 18%, transparent); }
.learning-primary-button:hover { background: color-mix(in srgb, var(--accent) 86%, #000); }
.learning-primary-button.is-danger { background: #b54b5b; border-color: #b54b5b; }
button:disabled { opacity: .5; cursor: not-allowed; box-shadow: none; }

.learning-source-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 62px;
  padding: 10px 24px;
  background: var(--surface-raised);
  border-bottom: 1px solid var(--theme-line-soft);
}
.learning-upload-copy { flex: 0 0 auto; display: grid; gap: 2px; }
.learning-upload-copy strong { color: var(--text-primary); font-size: 0.857143rem; }
.learning-upload-copy span { color: var(--text-tertiary); font-size: 0.714286rem; }
.learning-file-input { display: none; }
.learning-document-list {
  min-width: 0;
  flex: 1;
  display: flex;
  gap: 7px;
  margin: 0;
  padding: 0;
  overflow-x: auto;
  list-style: none;
}
.learning-document-list li {
  flex: 0 1 190px;
  min-width: 130px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 6px;
  padding: 7px 8px 7px 10px;
  border: 1px solid var(--theme-line-soft);
  border-radius: 9px;
  background: var(--surface-muted);
}
.learning-document-list li > span { overflow: hidden; color: var(--text-secondary); font-size: 0.785714rem; text-overflow: ellipsis; white-space: nowrap; }
.learning-document-list small { color: var(--text-tertiary); font-size: 0.714286rem; white-space: nowrap; }
.learning-document-list button { border: 0; color: var(--text-tertiary); background: transparent; cursor: pointer; }
.learning-document-empty { flex: 1; color: var(--text-tertiary); font-size: 0.785714rem; }

.learning-tabs {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  padding: 0 24px;
  background: var(--surface-raised);
  border-bottom: 1px solid var(--theme-line-soft);
}
.learning-tabs button {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 48px;
  border: 0;
  color: var(--text-secondary);
  background: transparent;
  cursor: pointer;
}
.learning-tabs button::after { position: absolute; right: 0; bottom: 0; left: 0; height: 2px; content: ""; background: transparent; }
.learning-tabs button.is-active { color: var(--accent); }
.learning-tabs button.is-active::after { background: var(--accent); }
.learning-tabs button > span { display: grid; place-items: center; width: 21px; height: 21px; border-radius: 7px; color: var(--text-tertiary); background: var(--surface-muted); font-size: 0.714286rem; }
.learning-tabs button.is-active > span { color: #fff; background: var(--accent); }
.learning-tabs button strong { font-size: 0.857143rem; }
.learning-tabs button > i { width: 6px; height: 6px; border-radius: 50%; background: #35a777; }

.learning-body { min-height: 0; display: grid; grid-template-columns: minmax(0, 1.65fr) minmax(340px, .8fr); }
.learning-result-pane { min-width: 0; min-height: 0; overflow: auto; padding: 20px 22px 24px; background: var(--surface-main); }
.learning-panel-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; margin-bottom: 13px; }
.learning-panel-head h3 { margin: 3px 0 0; color: var(--text-primary); font-size: 1.285714rem; }
.learning-panel-head p { margin: 4px 0 0; color: var(--text-secondary); font-size: 0.785714rem; }

.learning-target-strip {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin-bottom: 12px;
  padding: 11px;
  border: 1px solid var(--theme-line-soft);
  border-radius: 12px;
  background: var(--surface-raised);
}
.learning-target-strip.is-single { grid-template-columns: minmax(220px, .7fr) 1fr; align-items: end; }
.learning-target-strip label { display: grid; gap: 4px; }
.learning-target-strip label span { color: var(--text-secondary); font-size: 0.785714rem; font-weight: 700; }
.learning-target-strip select,
.learning-agent-head select,
.learning-title-field input,
.learning-new-library-name {
  width: 100%;
  height: 32px;
  padding: 0 9px;
  border: 1px solid var(--theme-line);
  border-radius: 8px;
  color: var(--text-primary);
  background: var(--surface-main);
  font-size: 0.785714rem;
  outline: none;
}
.learning-target-strip select:focus,
.learning-agent-head select:focus,
.learning-title-field input:focus,
.learning-new-library-name:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
.learning-target-strip p { align-self: center; margin: 0; color: var(--text-tertiary); font-size: 0.714286rem; }

.learning-material-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.learning-result-stack { display: grid; gap: 11px; }
.learning-result-stack.is-style { grid-template-rows: auto minmax(300px, 1fr); }
.learning-result-field,
.learning-title-field { min-width: 0; display: grid; gap: 6px; }
.learning-result-field > span,
.learning-title-field > span { color: var(--text-secondary); font-size: 0.785714rem; font-weight: 750; }
.learning-result-field textarea {
  width: 100%;
  min-height: 150px;
  resize: vertical;
  padding: 11px 12px;
  border: 1px solid var(--theme-line);
  border-radius: 11px;
  color: var(--text-primary);
  background: var(--surface-raised);
  font: 0.857143rem/1.65 inherit;
  outline: none;
  box-sizing: border-box;
}
.learning-result-stack .learning-result-field textarea { min-height: 220px; }
.learning-result-stack.is-style .learning-result-field textarea { height: 100%; min-height: 300px; }
.learning-result-field textarea:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
.learning-result-field textarea:disabled { color: var(--text-secondary); background: var(--surface-muted); }

.learning-agent-pane { min-width: 0; min-height: 0; display: grid; grid-template-rows: auto auto minmax(0, 1fr) auto; background: var(--surface-raised); border-left: 1px solid var(--theme-line-soft); }
.learning-agent-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 16px 11px; }
.learning-agent-head > div { min-width: 0; display: flex; align-items: center; gap: 9px; }
.learning-agent-mark { display: grid; place-items: center; width: 31px; height: 31px; border-radius: 10px; color: #fff; background: linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent) 68%, #5b80c5)); font-size: 0.714286rem; font-weight: 800; }
.learning-agent-head p { min-width: 0; display: grid; gap: 1px; margin: 0; }
.learning-agent-head strong { color: var(--text-primary); font-size: 0.857143rem; }
.learning-agent-head small { overflow: hidden; color: var(--text-tertiary); font-size: 0.714286rem; text-overflow: ellipsis; white-space: nowrap; }
.learning-agent-head select { width: 130px; flex: 0 0 auto; }

.learning-quick-actions { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; padding: 0 13px 12px; border-bottom: 1px solid var(--theme-line-soft); }
.learning-quick-actions button { min-width: 0; display: flex; align-items: center; gap: 6px; padding: 8px 7px; border: 1px solid var(--theme-line-soft); border-radius: 10px; color: var(--text-secondary); background: var(--surface-muted); text-align: left; cursor: pointer; }
.learning-quick-actions button:hover:not(:disabled),
.learning-quick-actions button.is-current { border-color: var(--accent); background: var(--accent-soft); }
.learning-quick-actions button > span { color: var(--accent); font-size: 0.928571rem; }
.learning-quick-actions p { min-width: 0; display: grid; gap: 1px; margin: 0; }
.learning-quick-actions strong { overflow: hidden; font-size: 0.785714rem; text-overflow: ellipsis; white-space: nowrap; }
.learning-quick-actions small { overflow: hidden; color: var(--text-tertiary); font-size: 0.714286rem; text-overflow: ellipsis; white-space: nowrap; }

.learning-chat-log { min-height: 0; overflow: auto; display: flex; flex-direction: column; gap: 9px; padding: 14px; background: linear-gradient(var(--surface-muted), var(--surface-raised)); }
.learning-chat-empty { margin: auto; max-width: 240px; display: grid; justify-items: center; gap: 6px; color: var(--text-tertiary); text-align: center; }
.learning-chat-empty > span { display: grid; place-items: center; width: 36px; height: 36px; border-radius: 12px; color: var(--accent); background: var(--accent-soft); }
.learning-chat-empty strong { color: var(--text-secondary); font-size: 0.785714rem; }
.learning-chat-empty p { margin: 0; font-size: 0.714286rem; line-height: 1.55; }
.learning-chat-message { max-width: 92%; padding: 9px 11px; border: 1px solid var(--theme-line-soft); border-radius: 12px 12px 12px 3px; background: var(--surface-raised); box-shadow: 0 3px 10px rgb(0 0 0 / 4%); }
.learning-chat-message.is-user { align-self: flex-end; border-color: color-mix(in srgb, var(--accent) 28%, var(--theme-line)); border-radius: 12px 12px 3px 12px; background: var(--accent-soft); }
.learning-chat-message > small { display: block; margin-bottom: 4px; color: var(--text-tertiary); font-size: 0.714286rem; font-weight: 700; }
.learning-chat-message > p,
.learning-thinking p { margin: 0; color: var(--text-primary); font-size: 0.857143rem; line-height: 1.55; white-space: pre-wrap; overflow-wrap: anywhere; }
.learning-thinking { margin-bottom: 5px; color: var(--text-secondary); font-size: 0.714286rem; }
.learning-thinking summary { cursor: pointer; }
.learning-thinking p { margin-top: 5px; color: var(--text-secondary); }
.learning-tool-list { display: grid; gap: 5px; padding-top: 3px; }
.learning-tool-list > div { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 6px; padding: 6px 8px; border: 1px solid var(--theme-line-soft); border-radius: 8px; color: var(--text-secondary); background: var(--surface-raised); font-size: 0.714286rem; }
.learning-tool-list i { width: 6px; height: 6px; border-radius: 50%; background: var(--text-tertiary); }
.learning-tool-list i[data-status="running"],
.learning-tool-list i[data-status="preparing"] { background: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 12%, transparent); }
.learning-tool-list i[data-status="completed"] { background: #35a777; }
.learning-tool-list i[data-status="error"] { background: #d15a67; }
.learning-tool-list small { color: var(--text-tertiary); }

.learning-agent-composer { padding: 9px 13px 12px; border-top: 1px solid var(--theme-line-soft); }
.learning-mode-toggle { padding: 4px 0; border: 0; color: var(--accent); background: transparent; font-size: 0.785714rem; font-weight: 700; cursor: pointer; }
.learning-mode-toggle.is-active { color: var(--text-primary); }
.learning-custom-input { display: grid; grid-template-columns: 1fr auto; gap: 7px; margin-top: 5px; }
.learning-custom-input textarea { height: 58px; resize: none; padding: 8px; border: 1px solid var(--theme-line); border-radius: 9px; color: var(--text-primary); background: var(--surface-main); font: 0.857143rem/1.45 inherit; outline: none; }
.learning-custom-input textarea:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
.learning-custom-input button,
.learning-running-footer button { padding: 0 11px; border: 0; border-radius: 8px; color: #fff; background: var(--accent); font-size: 0.785714rem; cursor: pointer; }
.learning-running-footer { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 7px; padding: 7px 8px; border-radius: 8px; color: var(--text-secondary); background: var(--accent-soft); font-size: 0.714286rem; }
.learning-running-footer button { min-height: 24px; background: color-mix(in srgb, var(--accent) 82%, var(--text-primary)); }

.learning-confirm-backdrop { position: absolute; inset: 0; z-index: 2; display: grid; place-items: center; background: rgb(27 20 35 / 43%); backdrop-filter: blur(4px); }
.learning-confirm-dialog { width: min(480px, calc(100vw - 44px)); padding: 20px; border: 1px solid var(--theme-line); border-radius: 17px; background: var(--surface-raised); box-shadow: 0 20px 60px rgb(0 0 0 / 30%); }
.learning-confirm-dialog.is-compact { width: min(430px, calc(100vw - 44px)); }
.learning-confirm-dialog header { display: flex; align-items: flex-start; justify-content: space-between; }
.learning-confirm-dialog h3 { margin: 3px 0 0; color: var(--text-primary); font-size: 1.285714rem; }
.learning-confirm-dialog > p { margin: 14px 0 0; color: var(--text-secondary); font-size: 0.857143rem; line-height: 1.6; }
.learning-save-summary { margin-top: 12px; padding: 10px; border-radius: 9px; color: var(--text-secondary); background: var(--surface-muted); font-size: 0.785714rem; }
.learning-confirm-dialog .learning-save-note { color: var(--text-tertiary); font-size: 0.714286rem; }
.learning-confirm-dialog footer { display: flex; justify-content: flex-end; gap: 8px; margin-top: 18px; }

@media (max-width: 1080px) {
  .learning-backdrop { padding: 12px; }
  .learning-dialog { width: calc(100vw - 24px); height: calc(100vh - 24px); }
  .learning-head { padding-right: 18px; padding-left: 18px; }
  .learning-source-bar,
  .learning-tabs { padding-right: 18px; padding-left: 18px; }
  .learning-body { grid-template-columns: minmax(0, 1fr) minmax(310px, 0.72fr); }
  .learning-result-pane { padding-right: 17px; padding-left: 17px; }
  .learning-target-strip.is-single { grid-template-columns: 1fr; align-items: stretch; }
  .learning-quick-actions { grid-template-columns: 1fr; }
  .learning-quick-actions button { min-height: 40px; padding-right: 10px; padding-left: 10px; }
  .learning-quick-actions small { overflow: visible; text-overflow: clip; white-space: normal; }
}

@media (max-height: 720px) {
  .learning-backdrop { padding: 8px; }
  .learning-dialog { height: calc(100vh - 16px); min-height: 0; }
  .learning-head { padding-top: 12px; padding-bottom: 10px; }
  .learning-title-block > p { margin-top: 4px; }
  .learning-source-bar { min-height: 52px; padding-top: 7px; padding-bottom: 7px; }
  .learning-tabs button { height: 40px; }
  .learning-result-pane { padding-top: 14px; padding-bottom: 16px; }
  .learning-agent-head { padding-top: 10px; padding-bottom: 8px; }
  .learning-quick-actions { padding-bottom: 8px; }
  .learning-result-field textarea { min-height: 120px; }
  .learning-result-stack .learning-result-field textarea { min-height: 180px; }
  .learning-result-stack.is-style .learning-result-field textarea { min-height: 220px; }
}
</style>
