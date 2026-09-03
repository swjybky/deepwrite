import { describe, expect, it } from "vitest";
import shellSource from "../WorkspaceShell.vue?raw";
import editorBridgeSource from "../composables/useLongWorkspaceModuleEditorBridge.ts?raw";
import editorSource from "./LongWorkspaceEditor.vue?raw";
import source from "./LongWorkspaceModule.vue?raw";

describe("LongWorkspaceModule boundary", () => {
  it("owns the long conversation and editor surface", () => {
    expect(shellSource).toContain("<LongWorkspaceModule");
    expect(shellSource).not.toContain("<LongWorkspaceEditor");
    expect(source).toContain("<AgentConversation");
    expect(source).toContain("<LongWorkspaceEditor");
    expect(source).toContain('class="long-agent-column"');
    expect(source).toContain('class="pane-resizer pane-resizer-right"');
    expect(source).toContain("paneLayout: WorkspacePaneLayout");
    expect(source).toContain(
      "paneLayout === 'agent-editor' || !rightPane.collapsed"
    );
    expect(source).toContain(
      "paneLayout === 'editor-agent' || !rightPane.collapsed"
    );
    expect(source).toContain('v-if="!rightPane.collapsed"');
    expect(source).toContain(':right-pane-collapsed="rightPane.collapsed"');
    expect(editorSource).toContain('aria-label="展开智能体栏"');
    expect(editorSource).toContain("emit('toggleRight')");
    expect(shellSource).toContain(':right-pane="writingRightPaneViewModel"');
    expect(shellSource).toContain(
      "@resize-start=\"startPaneResize('right', $event)\""
    );
    expect(shellSource).toContain(
      "@resize-keydown=\"handleResizeKeydown('right', $event)\""
    );
  });

  it("reads high-frequency conversation state below the shell boundary", () => {
    expect(shellSource).toContain(
      ':conversation-controller="activeLongConversation"'
    );
    expect(shellSource).not.toContain("const longMessages = computed(");
    expect(shellSource).not.toContain("const longComposerDraft = computed(");
    expect(source).toContain("conversationController.messages.value");
    expect(source).toContain("props.conversationController?.draft.value");
    expect(source).toContain("conversationController.isBusy.value");
    expect(source).not.toMatch(/\bany\b/u);
  });

  it("preserves the inner editor port and multi-argument event contracts", () => {
    expect(source).toContain(
      "editorPortChange: [port: LongWorkspaceEditorPort | null]"
    );
    expect(source).toContain(':ref="captureEditorPort"');
    expect(source).toContain(
      'import LongWorkspaceEditor from "./LongWorkspaceEditor.vue"'
    );
    expect(source).toContain("useLongWorkspaceModuleEditorBridge({");
    expect(editorBridgeSource).toContain("isLongWorkspaceEditorPort(instance)");
    expect(source).not.toContain(
      'import { LongWorkspaceEditor } from "./lazyAppComponents"'
    );
    expect(editorBridgeSource).toContain("options.publish(null)");
    expect(shellSource).toContain(
      '@editor-port-change="updateLongWorkspaceEditorPort"'
    );
    expect(source).toContain('emit("renameStructureTitle", input, completion)');
    expect(source).toContain('emit("mutation", batch, completion)');
  });
});
