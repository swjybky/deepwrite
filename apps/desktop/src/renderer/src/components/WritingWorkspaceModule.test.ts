import { expectSourceToContain } from "../../../test-utils/sourceText";
import { describe, expect, it } from "vitest";
import appSource from "../WorkspaceShell.vue?raw";
import asyncComponentsSource from "./lazyAppComponents.ts?raw";
import featureImportsSource from "./lazyFeatureImports.ts?raw";
const lazyComponentsSource = `${asyncComponentsSource}\n${featureImportsSource}`;
import source from "./WritingWorkspaceModule.vue?raw";

describe("WritingWorkspaceModule boundary", () => {
  it("owns the default short and script conversation/editor surface", () => {
    expect(source).toContain("<AgentConversation");
    expect(source).toMatch(
      /import \{[^}]*\bAgentConversation\b[^}]*\} from "\.\/lazyAppComponents"/
    );
    expect(source).not.toContain(
      'import AgentConversation from "./AgentConversation.vue"'
    );
    expectSourceToContain(
      lazyComponentsSource,
      '() => import("./AgentConversation.vue")'
    );
    expect(source).toContain("<RightEditorPane");
    expect(source).toContain('class="pane-resizer pane-resizer-right"');
    expect(source).toContain("paneLayout: WorkspacePaneLayout");
    expect(source).toContain(
      "paneLayout === 'agent-editor' || !rightPane.collapsed"
    );
    expect(source).toContain(
      "paneLayout === 'editor-agent' || !rightPane.collapsed"
    );
    expect(source).toContain(":right-pane=\"paneLayout === 'editor-agent'\"");
    expect(source).toContain(":right-pane=\"paneLayout === 'agent-editor'\"");
    expect(appSource).toContain("<WritingWorkspaceModule");
    expect(appSource).toContain("activeFeature === 'conversation'");
    expect(appSource).not.toContain("<RightEditorPane");
  });

  it("keeps high-frequency conversation refs inside the module", () => {
    expect(source).toContain(
      "conversationController: AgentConversationController"
    );
    expect(source).toContain("conversationContext: WritingConversationContext");
    expect(source).toContain('v-bind="conversationContext"');
    expect(source).toContain(
      ':messages="conversationController.messages.value"'
    );
    expect(source).toContain(':draft="conversationController.draft.value"');
    expect(source).toContain('v-bind="editor"');
    expect(source).toContain("AgentConversationPublicProps");
    expect(source).toContain("RightEditorPanePublicProps");
    expect(source).not.toMatch(/\bany\b/u);
    expect(appSource).toContain(
      ':conversation-controller="activeConversation"'
    );
    expect(appSource).toContain(
      ':conversation-context="writingConversationContext"'
    );
    expect(appSource).toContain('@update:draft="updateComposerDraft"');
    expect(appSource).not.toContain("const writingWorkspaceViewModel");
    expect(appSource).not.toContain("const composerDraft = computed");
    expect(appSource).toContain('@save="applyDocument"');
    expect(appSource).toContain(
      "@resize-start=\"startPaneResize('right', $event)\""
    );
  });

  it("keeps the left navigation resizer in the App shell", () => {
    expect(appSource).toContain('class="pane-resizer pane-resizer-left"');
    expect(source).not.toContain("pane-resizer-left");
    expect(source).not.toContain("workspaceMainView");
  });
});
