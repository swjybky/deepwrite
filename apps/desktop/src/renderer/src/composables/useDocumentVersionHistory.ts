import type {
  DocumentVersionsApi,
  DocumentVersionTarget,
  DocumentVersionSummary,
  ListDocumentVersionsResult,
  RestoreDocumentVersionResult
} from "@deepwrite/contracts";
import { computed, getCurrentScope, onScopeDispose, ref } from "vue";
import { createScopedTranslator } from "../i18n";
import { formatError, getErrorPayload } from "../i18n/errors";
import { uiMessage } from "../ui-feedback";
import { buildAgentTextDiff } from "../utils/agentTextDiff";

const t = createScopedTranslator("components.documentVersions");

export interface DocumentVersionHistoryOptions {
  target(): DocumentVersionTarget;
  content(): string;
  busy(): boolean;
  restoreDisabledReason?(): string;
  unsaved(): boolean;
  autoSave(): boolean;
  prepareRestore(): Promise<boolean>;
  restored(result: RestoreDocumentVersionResult): Promise<void> | void;
  close(): void;
  api?(): DocumentVersionsApi | undefined;
}

export function useDocumentVersionHistory(
  options: DocumentVersionHistoryOptions
) {
  const snapshot = ref<ListDocumentVersionsResult>({
    versions: [],
    current: null
  });
  const selectedId = ref<string | null>(null);
  const content = ref("");
  const previousContent = ref<string | null>(null);
  const loading = ref(false);
  const restoring = ref(false);
  const confirming = ref(false);
  let listRequest = 0;
  let readRequest = 0;
  let disposed = false;
  if (getCurrentScope())
    onScopeDispose(() => {
      disposed = true;
      listRequest++;
      readRequest++;
    });
  const api = () => options.api?.() ?? window.deepwrite?.versions;
  const versions = computed(() => snapshot.value.versions);
  const selected = computed(() =>
    versions.value.find(({ id }) => id === selectedId.value)
  );
  const currentChanged = computed(() =>
    Boolean(
      snapshot.value.current &&
      (versions.value[0]
        ? versions.value[0].sha256 !== snapshot.value.current.sha256
        : snapshot.value.current.charCount > 0)
    )
  );
  const blockedReason = computed(() =>
    options.busy()
      ? t("busy")
      : options.restoreDisabledReason?.() ||
        (options.unsaved() && !options.autoSave() ? t("unsaved") : "")
  );
  const canRestore = computed(() =>
    Boolean(
      selected.value &&
      snapshot.value.current &&
      !restoring.value &&
      !blockedReason.value &&
      !(
        selected.value.sha256 === snapshot.value.current.sha256 &&
        !options.unsaved()
      )
    )
  );
  const displayedContent = computed(() =>
    selectedId.value ? content.value : options.content()
  );
  const hasComparison = computed(() => previousContent.value !== null);
  const diff = computed(() => ({
    id: selectedId.value ?? "current",
    ...(previousContent.value === null
      ? { additions: 0, deletions: 0, hunks: [], truncated: false }
      : buildAgentTextDiff(previousContent.value, displayedContent.value))
  }));

  async function handleError(cause: unknown): Promise<void> {
    if (disposed) return;
    switch (getErrorPayload(cause)?.code) {
      case "version.disabled":
        options.close();
        return;
      case "version.conflict":
        confirming.value = false;
        uiMessage.info(t("conflict"));
        await refresh();
        return;
      case "version.busy":
        uiMessage.info(t("busy"));
        return;
      case "version.unavailable":
        uiMessage.error(t("unavailable"));
        return;
      default:
        uiMessage.error(formatError(cause, t("unavailable")));
    }
  }

  async function loadSelection(): Promise<void> {
    const currentApi = api();
    if (!currentApi) return;
    const request = ++readRequest;
    const target = options.target();
    const identity = JSON.stringify(target);
    const selectedVersion = selected.value;
    const index = selectedVersion
      ? versions.value.findIndex(({ id }) => id === selectedVersion.id)
      : -1;
    const previous =
      index >= 0
        ? (versions.value[index + 1] ?? versions.value[0])
        : versions.value[0];
    content.value = "";
    previousContent.value = null;
    loading.value = true;
    try {
      const [chosen, before] = await Promise.all([
        selectedVersion
          ? currentApi.read({ target, versionId: selectedVersion.id })
          : undefined,
        previous && previous.id !== selectedVersion?.id
          ? currentApi.read({ target, versionId: previous.id })
          : undefined
      ]);
      if (
        disposed ||
        request !== readRequest ||
        JSON.stringify(options.target()) !== identity
      )
        return;
      content.value = chosen?.content ?? "";
      previousContent.value =
        before?.content ?? (previous ? (chosen?.content ?? null) : null);
    } catch (cause) {
      if (request === readRequest) await handleError(cause);
    } finally {
      if (request === readRequest) loading.value = false;
    }
  }

  async function select(id: string | null): Promise<void> {
    selectedId.value = id;
    confirming.value = false;
    await loadSelection();
  }

  async function refresh(selection = selectedId.value): Promise<void> {
    const currentApi = api();
    if (!currentApi) return;
    const request = ++listRequest;
    const target = options.target();
    const identity = JSON.stringify(target);
    try {
      const next = await currentApi.list({ target });
      if (
        disposed ||
        request !== listRequest ||
        JSON.stringify(options.target()) !== identity
      )
        return;
      snapshot.value = {
        ...next,
        versions: [...next.versions].sort((a, b) => b.seq - a.seq)
      };
      selectedId.value = next.versions.some(({ id }) => id === selection)
        ? selection
        : null;
      await loadSelection();
    } catch (cause) {
      if (request === listRequest) await handleError(cause);
    }
  }

  async function restore(): Promise<void> {
    const currentApi = api();
    const version = selected.value;
    if (!currentApi || !version || !canRestore.value) return;
    const target = options.target();
    restoring.value = true;
    try {
      const needsSave = options.unsaved();
      if (
        !(await options.prepareRestore()) ||
        disposed ||
        options.busy() ||
        options.restoreDisabledReason?.()
      )
        return;
      if (needsSave) await refresh(version.id);
      const current = snapshot.value.current;
      if (
        !current ||
        disposed ||
        JSON.stringify(options.target()) !== JSON.stringify(target)
      )
        return;
      const result = await currentApi.restore({
        target,
        versionId: version.id,
        expectedCurrentSha256: current.sha256
      });
      if (disposed) return;
      await options.restored(result);
      confirming.value = false;
      await refresh(result.version?.id ?? null);
      uiMessage.success(t("success", { seq: version.seq }));
    } catch (cause) {
      await handleError(cause);
    } finally {
      restoring.value = false;
    }
  }

  function label(version: DocumentVersionSummary): string {
    return version.kind === "conversation"
      ? t("edit")
      : version.kind === "restore"
        ? t("restored", { seq: version.restoredFromSeq ?? "" })
        : version.reason === "restore"
          ? t("preRestore")
          : t("before");
  }

  return {
    versions,
    selectedId,
    selected,
    displayedContent,
    hasComparison,
    diff,
    currentChanged,
    loading,
    restoring,
    confirming,
    blockedReason,
    canRestore,
    refresh,
    select,
    restore,
    label
  };
}
