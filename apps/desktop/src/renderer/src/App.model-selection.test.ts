import { describe, expect, it } from "vitest";
import source from "./WorkspaceShell.vue?raw";
import runtimeRegistrySource from "./composables/conversationRegistryPreferences.ts?raw";
import registryPortSource from "./composables/conversationRuntimeRegistryStorePort.ts?raw";
import shortConversationSource from "./composables/useShortConversationCoordinator.ts?raw";

function functionBody(text: string, name: string, nextName: string): string {
  const start = text.indexOf(`function ${name}(`);
  const end = text.indexOf(`function ${nextName}(`, start);
  return text.slice(start, end);
}

describe("App agent model selection", () => {
  it("restores and persists the global model selection across app launches", () => {
    expect(source).toContain(
      "store: conversationRuntimeRegistryStorePort(conversationStore)"
    );
    expect(registryPortSource).toContain("sessionAgentModelSelection");
    expect(registryPortSource).toContain("storeToRefs(store)");
    expect(source).toContain("createConversationPersistenceAdapter(");
    expect(source).toContain("{ storage: window.localStorage }");
    const body = functionBody(
      runtimeRegistrySource,
      "synchronizeSessionAgentModelSelection",
      "persistAgentRunPreferences"
    );
    expect(source).toContain("useConversationRuntimeRegistryCoordinator({");
    expect(body).toContain("options.store.setSessionAgentModelSelection(");
    expect(body).toContain("{ source }");
    expect(body).not.toContain("localStorage");
    expect(body).not.toContain("JSON.stringify");
  });

  it("keeps the selected conversation stable while publishing a model change", () => {
    const body = functionBody(
      shortConversationSource,
      "selectModel",
      "selectThinking"
    );

    expect(body).toContain("const conversation = activeConversation.value;");
    expect(body).toContain("conversation.selectModel(modelId);");
    expect(body).toContain(
      "options.runtime.synchronizeSessionModelSelection(conversation);"
    );
    expect(body.match(/activeConversation\.value/g)).toHaveLength(1);
  });

  it("keeps the selected conversation stable while publishing a thinking-level change", () => {
    const body = functionBody(
      shortConversationSource,
      "selectThinking",
      "selectWebSearch"
    );

    expect(body).toContain("const conversation = activeConversation.value;");
    expect(body).toContain("conversation.selectThinkingLevel(level);");
    expect(body).toContain(
      "options.runtime.synchronizeSessionModelSelection(conversation);"
    );
    expect(body.match(/activeConversation\.value/g)).toHaveLength(1);
  });

  it("keeps the selected conversation stable while publishing a web-search change", () => {
    const body = functionBody(
      shortConversationSource,
      "selectWebSearch",
      "selectTemperature"
    );

    expect(body).toContain("const conversation = activeConversation.value;");
    expect(body).toContain("conversation.selectWebSearchEnabled(enabled);");
    expect(body).toContain(
      "options.runtime.synchronizeSessionModelSelection(conversation);"
    );
    expect(body.match(/activeConversation\.value/g)).toHaveLength(1);
  });
});
