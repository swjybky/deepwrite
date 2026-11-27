<script setup lang="ts">
import { deepwriteApi } from "../../api/deepwrite";
import type {
  MysteryBookManifest,
  MysteryDocumentTarget,
  RestoreDocumentVersionResult,
  TextViewMode
} from "@deepwrite/contracts";
import {
  mysteryDocumentRelativePath,
  mysteryDocumentTargetKey,
  mysteryDocumentTitle,
  mysteryStageForTarget
} from "@deepwrite/contracts/renderer";
import { computed } from "vue";
import AppIcon from "../../components/AppIcon.vue";
import RightEditorPane from "../../components/RightEditorPane.vue";
import type { EditorDocumentVersionPort } from "../../composables/useEditorDocumentVersions";
import type {
  EditorTextReference,
  EditorTextReferenceNavigation
} from "../../types/conversation";
import type { WorkspaceDocument } from "../../types/workspace";
import { mysteryDocumentResourceId } from "../../stores/mysteryWorkspaceStore";
import { mysteryStagePresentation } from "../../utils/mysteryWorkspaceResourceTree";
import { mysteryT } from "./messages";
import { mysteryLabels } from "./mysterySharedLabels";

const props = defineProps<{
  manifest: MysteryBookManifest;
  target: MysteryDocumentTarget;
  content: string;
  dirty: boolean;
  locked: boolean;
  saving: boolean;
  agentBusy: boolean;
  autoSaveEnabled: boolean;
  defaultTextViewMode: TextViewMode;
  leftCollapsed: boolean;
  rightPane: boolean;
  rightPaneCollapsed: boolean;
  locateReference?: EditorTextReferenceNavigation | undefined;
  saveDocument(): Promise<boolean>;
  reloadRestoredDocument(result: RestoreDocumentVersionResult): Promise<void>;
}>();
const emit = defineEmits<{
  "update:content": [value: string];
  composing: [value: boolean];
  openResource: [resourceId: string];
  insertSelection: [reference: EditorTextReference];
  expandLeft: [];
  toggleRight: [];
}>();

const document = computed<WorkspaceDocument>(() => {
  const { manifest, target } = props;
  const title = mysteryDocumentTitle(manifest, target);
  const stage = mysteryStagePresentation(mysteryStageForTarget(target)).label;
  return {
    id: mysteryDocumentResourceId(manifest.id, target),
    workspaceId: manifest.id,
    workspaceType: "mystery",
    domain: "creation",
    title,
    eyebrow: stage,
    path: [manifest.title, stage, title],
    content: props.content
  };
});
const playerBody = computed(
  () => props.target.kind === "player_act" && props.target.document === "body"
);
const relatedFiles = computed(() => {
  const target = props.target;
  if (target.kind === "role") {
    return (["profile", "pitch"] as const).map((kind) => ({
      target: { ...target, document: kind },
      active: kind === target.document,
      label: mysteryLabels(
        kind === "profile" ? "roleProfileTab" : "rolePitchTab"
      )
    }));
  }
  if (target.kind === "player_act") {
    return (["brief", "body"] as const).map((kind) => ({
      target: { ...target, document: kind },
      active: kind === target.document,
      label: mysteryLabels(kind === "brief" ? "actBriefTab" : "actBodyTab")
    }));
  }
  return [];
});
const versioning = computed<EditorDocumentVersionPort>(() => ({
  target:
    props.target.kind === "agents_md"
      ? null
      : {
          workspace: "mystery",
          bookId: props.manifest.id,
          targetKey: mysteryDocumentTargetKey(props.target),
          target: { ...props.target }
        },
  busy: props.agentBusy,
  prepareRestore: props.saveDocument,
  applyRestore: props.reloadRestoredDocument
}));

async function searchEntries(query: string) {
  const api = deepwriteApi()?.mystery;
  if (!api) return [];
  const bookId = props.manifest.id;
  const result = await api.search({ bookId, query, limit: 30 });
  return result.hits.map((hit) => ({
    id: mysteryDocumentResourceId(bookId, hit.target),
    title: hit.title,
    detail: hit.snippet
  }));
}
</script>

<template>
  <RightEditorPane
    :document="document"
    :resource-id="document.id"
    :draft-state="{ title: document.title, content, dirty }"
    :locked="locked"
    :saving="saving"
    :manual-saving="!autoSaveEnabled && saving"
    :default-view-mode="defaultTextViewMode"
    :auto-save-enabled="autoSaveEnabled"
    :right-pane="rightPane"
    :right-pane-collapsed="rightPaneCollapsed"
    :locate-reference="locateReference"
    :versioning="versioning"
    :body-format-kind="playerBody ? 'script' : undefined"
    :search-entries="searchEntries"
    @save="saveDocument()"
    @live-change="emit('update:content', $event.content)"
    @composition-change="emit('composing', $event.composing)"
    @insert-selection="emit('insertSelection', $event)"
    @select-entry-search-result="emit('openResource', $event)"
    @collapse="emit('toggleRight')"
    @toggle-right="emit('toggleRight')"
  >
    <template v-if="leftCollapsed && !rightPane" #toolbar-start>
      <button
        type="button"
        class="icon-button"
        :aria-label="mysteryT('expandStages')"
        @click="emit('expandLeft')"
      >
        <AppIcon name="panel-left" :size="18" />
      </button>
    </template>
    <template v-if="relatedFiles.length" #related-files>
      <button
        v-for="file in relatedFiles"
        :key="file.target.document"
        type="button"
        role="tab"
        :aria-selected="file.active"
        :class="{ 'is-active': file.active }"
        @click="
          emit(
            'openResource',
            mysteryDocumentResourceId(manifest.id, file.target)
          )
        "
      >
        {{ file.label }}
      </button>
    </template>
    <template #document-heading>
      <h2
        class="document-title-input"
        :title="mysteryDocumentRelativePath(target)"
      >
        {{ document.title }}
      </h2>
    </template>
  </RightEditorPane>
</template>
