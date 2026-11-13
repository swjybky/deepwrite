import footerSource from "./CatalogEditorFooterMeta.vue?raw";
import toolsSource from "./EditorTextTools.vue?raw";
import metadataSource from "./EditorDocumentMetadata.vue?raw";
import { describe, expect, it } from "vitest";
import { expectSourceToContain } from "../../../test-utils/sourceText";
import appSource from "../WorkspaceShell.vue?raw";
import editorSource from "./RightEditorPane.vue?raw";
import toggleSource from "./EditorPaneToggle.vue?raw";
// @ts-expect-error Loaded as source text by the Vitest-only virtual module.
import editorStyles from "virtual:deepwrite-renderer-styles";
import selectionMenuSource from "../../../main/text-context-menu-items.ts?raw";
import writingWorkspaceSource from "./WritingWorkspaceModule.vue?raw";
import persistenceSource from "../composables/useCatalogDocumentPersistence.ts?raw";
import resourceSource from "../composables/useWorkspaceResourceCoordinator.ts?raw";
import structureSource from "../composables/useShortWorkspaceStructureCoordinator.ts?raw";
import dialogLayerSource from "./WorkspaceDialogLayer.vue?raw";
import dialogCoordinatorSource from "../composables/useWorkspaceDialogModuleCoordinator.ts?raw";
import fixedTitleSource from "../utils/fixedWorkspaceDocumentTitle.ts?raw";
import saveViewportSource from "../composables/useEditorSaveViewport.ts?raw";
import scrollMemorySource from "../composables/useLongEditorScrollMemory.ts?raw";
import textViewModeSource from "../composables/useTextViewMode.ts?raw";
import selectionInsertionSource from "../composables/useEditorSelectionInsertion.ts?raw";

const source = `${editorSource}\n${toggleSource}\n${footerSource}`;

describe("RightEditorPane expert draft navigation", () => {
  it("loads the consolidated editor layout without stale header rows", () => {
    expect(editorStyles.match(/\.editor-pane\s*\{/g)).toHaveLength(1);
    expect(editorStyles).toContain(
      "grid-template-rows: 40px minmax(0, 1fr) 36px;"
    );
    expect(editorStyles).toContain(
      "grid-template-rows: 42px 40px minmax(0, 1fr) 36px;"
    );
    expect(editorStyles).not.toContain(
      'html[data-platform="darwin"] .editor-pane'
    );
  });

  it("expands a collapsed right-side agent when the editor is centered", () => {
    expect(source).toContain("rightPaneCollapsed?: boolean");
    expect(source).toContain("expandAgentPane");
    expect(source).toContain("emit('toggleRight')");
    expect(writingWorkspaceSource).toContain(
      ":right-pane=\"paneLayout === 'agent-editor'\""
    );
    expect(writingWorkspaceSource).toContain(
      "@toggle-right=\"emit('toggleRight')\""
    );
  });

  it("removes the separate header while preserving the footer save action", () => {
    expect(source).not.toContain("自动保存已开启");
    expect(source).not.toContain("visibleDirtySaveState");
    expect(source).not.toContain("editor-header");
    const toolbarStart = editorSource.indexOf('class="editor-toolbar"');
    const documentStart = editorSource.indexOf('class="editor-document"');
    expect(editorSource.slice(toolbarStart, documentStart)).toContain(
      "<EditorPaneToggle"
    );
    expect(source).not.toContain('autoSaveEnabled ? "等待自动保存"');
    expectSourceToContain(source, "on");
    expectSourceToContain(source, "saveNow");
  });

  it("reminds material and skill entries about the 40,000-character recommendation without blocking save", () => {
    expect(source).toContain("CATALOG_LIBRARY_ENTRY_MAX_CHARACTERS");
    expect(source).not.toContain(':maxlength="contentMaxLength"');
    expect(source).not.toContain(':maxlength="recommendedContentLength"');
    expect(source).toContain(
      "recommendedEntryLimit40000CharactersAvoidUploadingExcessive"
    );
    expect(source).toContain("contentExceedsRecommendedLength");
    expect(source).not.toContain("contentExceedsLimit");
  });

  it("keeps the editor save button outside the shrinking library hint row", () => {
    const footerStart = source.indexOf('class="editor-footer"');
    const metaStart = source.indexOf('class="editor-footer-meta"', footerStart);
    const hintStart = source.indexOf(
      'class="library-entry-limit-hint"',
      metaStart
    );
    const metaClose = source.indexOf("</div>", hintStart);
    const buttonStart = editorSource.indexOf(
      'class="save-button"',
      footerStart
    );

    expect(footerStart).toBeGreaterThan(-1);
    expect(metaStart).toBeGreaterThan(footerStart);
    expect(hintStart).toBeGreaterThan(metaStart);
    expect(hintStart).toBeLessThan(metaClose);
    expect(buttonStart).toBeGreaterThan(footerStart);
    expect(source).not.toContain('class="footer-spacer"');
  });

  it("shows a live, non-blocking format reason after the binding badge for skill entries", () => {
    expect(metadataSource).toContain(
      'import { parseSkillFrontmatter } from "../utils/skillFrontmatter"'
    );
    expect(metadataSource).toContain(
      'props.document.domain !== "skill" || !props.document.catalogEntryId'
    );
    expect(metadataSource).toContain("parseSkillFrontmatter(props.content)");

    const bindingBadge = metadataSource.indexOf("browseOnlyNotLinked");
    const formatBadge = metadataSource.indexOf(
      'class="skill-format-error-badge"'
    );
    expect(bindingBadge).toBeGreaterThan(-1);
    expect(formatBadge).toBeGreaterThan(bindingBadge);
    expect(metadataSource).toContain('v-if="skillFormatError"');
    expect(metadataSource).toContain(':title="skillFormatError"');
    expect(metadataSource).toContain(':aria-label="skillFormatError"');
    expect(metadataSource).not.toContain(
      "!dirty || contentExceedsRecommendedLength || skillFormatError"
    );
  });

  it("keeps structural overview titles fixed while routing overview content to persistent saves", () => {
    expect(source).toContain(
      'props.document.catalogLibraryField === "overview"'
    );
    expect(source).toContain("workspaceDocumentHasFixedTitle(props.document)");
    expect(source).toContain(':readonly="isTitleReadOnly"');
    expect(source).toContain("resolveWorkspaceDocumentTitle(");
    expect(fixedTitleSource).toContain(
      'document.characterFileKind === "overview"'
    );
    expect(fixedTitleSource).toContain("document.plotStageOrder !== undefined");
    expect(source).toContain("CATALOG_LIBRARY_OVERVIEW_MAX_CHARACTERS");
    expect(persistenceSource).toContain(
      "async function saveCatalogLibraryOverview("
    );
    expect(persistenceSource).toContain('catalogLibraryField !== "overview"');
    expect(persistenceSource).toContain("overview: payload.content");
    expect(persistenceSource).toContain("await saveCatalogLibraryOverview(");
    expect(persistenceSource).toContain("normalizedPayload");
  });

  it("renders independently managed section tabs before the active section editor", () => {
    const tabsStart = source.indexOf('class="section-tabs-bar"');
    const editorStart = source.indexOf('class="editor-document"', tabsStart);

    expect(tabsStart).toBeGreaterThan(-1);
    expect(source).toContain(':aria-label="resolvedSectionTabsLabel"');
    expect(source).toContain("manuscript");
    expect(source).toContain("episode");
    expect(source).toContain("emit('selectSection', section.id)");
    expect(source).toContain('v-if="canCreateSection"');
    expect(source).toContain(':aria-label="resolvedCreateSectionLabel"');
    expect(source).toContain("emit('createSection')");
    expect(source).toContain('v-if="showDeleteSection"');
    expect(source).toContain('class="section-tabs-remove"');
    expect(source).toContain("emit('deleteSection')");
    expect(editorStart).toBeGreaterThan(tabsStart);
  });

  it("remembers the scroll position of every section instead of reusing the previous section position", () => {
    expect(source).toContain("editorScrollMemoryKey(props.document)");
    expect(source).toContain("useLongEditorScrollMemory({");
    expect(source).toContain("bindIdentityWatch: false");
    expect(source).toContain(
      "rememberCurrentDocumentScroll(previousScrollMemoryKey)"
    );
    expect(source).toContain(
      "restoreDocumentScroll(nextScrollMemoryKey, nextViewMode)"
    );
    expect(source).toContain('@scroll="handleDocumentScroll"');
    expect(scrollMemorySource).toContain(
      "const scrollTop = recalledEditorScrollPosition(key, view)"
    );
    expect(scrollMemorySource).toContain("scroller.scrollTop = scrollTop");
    expect(saveViewportSource).toContain(
      "options.documentKey.value !== renderedDocumentKey"
    );
  });

  it("resets every ordinary text document to the persisted default view mode", () => {
    expect(source).toContain("defaultViewMode: TextViewMode");
    expect(source).toContain("useTextViewMode({");
    expect(source).toContain("defaultMode: () => props.defaultViewMode");
    expect(source).toContain("const nextViewMode = resetToDefault()");
    expect(source).toContain("() => props.defaultViewMode");
    expect(source).toContain("(mode) => selectViewMode(mode)");
    expect(textViewModeSource).toContain("function resetToDefault(");
    expect(writingWorkspaceSource).toContain('| "defaultViewMode"');
  });

  it("preserves the latest active text viewport across manual and automatic saves", () => {
    expect(source).toContain("preserveEditorViewportForSave()");
    expect(saveViewportSource).toContain("pendingSnapshot = capture()");
    expect(saveViewportSource).toContain(
      "const snapshot = capture() ?? pendingSnapshot"
    );
    expect(saveViewportSource).toContain(
      "input.scrollTop = snapshot.scrollTop"
    );
    expect(saveViewportSource).toContain(
      "input.selectionStart !== snapshot.selectionStart"
    );
    expect(saveViewportSource).toContain('{ flush: "pre" }');
    expect(source).toContain(
      "onBeforeUpdate(captureEditorViewportBeforeRender)"
    );
    expect(source).toContain("onUpdated(restoreEditorViewportAfterRender)");
    expect(source).toContain("saving");
    expect(source).toContain("@mousedown.prevent");
  });

  it("keeps the editor in place while an agent temporarily makes it readonly", () => {
    expect(source).toContain("isTransientlyReadOnly: () => props.locked");
    expect(source).toContain("agentRunningReadOnly");
    expect(source).toContain(':readonly="document.readOnly || locked"');
    expect(source).toContain("'is-readonly': document.readOnly");
    expect(source).toContain(
      "'without-metadata': document.domain === 'creation'"
    );
    expect(source).not.toContain(
      ":class=\"{ 'is-readonly': document.readOnly || locked }\""
    );
  });

  it("routes the short-story tab add button through a named confirmation dialog", () => {
    expect(structureSource).toContain(
      "async function addExpertSectionFromEditor()"
    );
    expect(structureSource).toContain('directory.workspaceType !== "short"');
    expect(structureSource).toContain("await addExpertSection(draftNode)");
    expect(structureSource).toContain("function requestCreateExpertSection(");
    expect(structureSource).toContain(
      "async function confirmCreateExpertSection("
    );
    expect(structureSource).toContain("suggestedDraftSectionTitle(");
    expect(structureSource).toContain("title,");
    expect(structureSource).toContain("await api.createDraftSection({");
    expect(dialogCoordinatorSource).toContain('kind: "create-expert-section"');
    expect(dialogLayerSource).toContain("<CreateExpertSectionDialog");
    expect(appSource).toContain('@create-section="createEditorSection"');
    expect(resourceSource).toContain(
      'activeDocument.value.workspaceType === "short"'
    );
  });

  it("routes the short-story tab remove button through the existing sidebar deletion flow", () => {
    expect(resourceSource).toContain(
      "const editorShowsExpertSectionTabs = computed"
    );
    expect(resourceSource).toContain(
      "const showEditorDeleteSection = computed"
    );
    expect(resourceSource).toContain(
      "workspaceResourceCoordinator.deleteCurrentSection"
    );
    expect(resourceSource).toContain("(directory?.sections.length ?? 0) > 1");
    expect(structureSource).toContain(
      "function removeExpertSectionFromEditor()"
    );
    expect(structureSource).toContain(
      "requestRemoveExpertSection(sectionNode)"
    );
    expect(appSource).toContain(
      "showDeleteSection: showEditorDeleteSection.value"
    );
    expect(writingWorkspaceSource).toContain('v-bind="editor"');
    expect(appSource).toContain('@delete-section="deleteEditorSection"');
  });

  it("reuses section tabs for list-style short character items with add and remove controls", () => {
    expect(resourceSource).toContain(
      "const activeCharacterItemTabs = computed"
    );
    expect(resourceSource).toContain(
      'book.characterStructure.format !== "list"'
    );
    expect(resourceSource).toContain("catalogWorkspace.overview");
    expect(resourceSource).toContain(
      "workspaceResourceCoordinator.characterEntry"
    );
    expect(resourceSource).toContain(
      "workspaceResourceCoordinator.newCharacterEntry"
    );
    expect(resourceSource).toContain(
      "workspaceResourceCoordinator.deleteCurrentCharacterEntry"
    );
    expect(appSource).toContain(
      "showDeleteSection: showEditorDeleteSection.value"
    );
    expect(structureSource).toContain("function addCharacterItemFromEditor()");
    expect(structureSource).toContain(
      "function deleteCharacterItemFromEditor()"
    );
    expect(appSource).toContain('@delete-section="deleteEditorSection"');
  });

  it("offers one insert action only after right-clicking a selected editor range", () => {
    expect(selectionMenuSource).toContain('nativeText("insertReference")');
    expect(source).toContain('@contextmenu="handleEditorContextMenu"');
    expect(source).toContain('@contextmenu="handlePreviewContextMenu"');
    expect(selectionInsertionSource).not.toContain("event.preventDefault()");
    expect(selectionInsertionSource).toContain(
      "function handlePreviewContextMenu"
    );
    expect(selectionInsertionSource).toContain(
      "preview.contains(selection.getRangeAt(0).commonAncestorContainer)"
    );
    expect(selectionInsertionSource).not.toContain("handleEditorMouseup");
    expect(selectionInsertionSource).not.toContain("handleEditorKeyup");
    expect(source).toContain('emit("insertSelection", reference)');
    expect(source).toContain(
      'input.setSelectionRange(range.start, range.end, "forward")'
    );
  });

  it("shares selection insertion across creation, material, and skill documents", () => {
    expect(writingWorkspaceSource).toContain("<RightEditorPane");
    expect(writingWorkspaceSource).toContain(
      "@insert-selection=\"emit('insertSelection', $event)\""
    );
    expect(appSource).toContain(
      '@insert-selection="insertEditorSelectionReference"'
    );
    expect(source).toContain(
      'props.document.domain === "material" ||\n      props.document.domain === "skill"'
    );
    expect(source).not.toContain("<EditorSelectionMenu");
  });

  it("provides working text undo, redo, find, and replace controls", () => {
    expect(toolsSource).toContain("undo");
    expect(toolsSource).toContain("redo");
    expect(toolsSource).toContain("find");
    expect(toolsSource).toContain("replace");
    expect(source).toContain('@beforeinput="handleEditorBeforeInput"');
    expect(source).toContain('@input="handleEditorInput"');
    expect(source).toContain('@keydown="handleEditorKeydown"');
    expect(source).toContain("createBoundedTextHistory()");
    expect(source).toContain("textHistory.recordInput({");
    expect(source).not.toContain("recordUndoSnapshot");
    expect(source).not.toContain("content.value.replace(/\\s/g");
    expect(source).toContain("replaceCurrentMatch");
    expect(source).toContain("replaceAllMatches");
    expect(source).not.toContain('aria-label="粗体"');
    expect(source).not.toContain('aria-label="斜体"');
    expect(source).not.toContain('aria-label="引用"');
  });

  it("renders creation, skill, and material document previews through Markdown", () => {
    expect(source).toContain(
      'import EditableMarkdownPreview from "./EditableMarkdownPreview.vue"'
    );
    expect(source).toContain("<EditableMarkdownPreview");
    expect(source).toContain("annotate-headings");
    expect(source).not.toContain('v-for="(paragraph, index) in paragraphs"');
  });
});
