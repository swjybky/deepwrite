import { t } from "../../i18n";
import { useChatAssistantRoleplays } from "./useChatAssistantRoleplays";
import type {
  CatalogIndexSnapshot,
  ChatAssistantMode,
  ChatAssistantProjectRef,
  ExtrasChatTask,
  LongBookSummary,
  UserPromptAttachment
} from "@deepwrite/contracts";
import { chatAssistantProjectKey as projectKey } from "@deepwrite/contracts/renderer";
import {
  chatTaskWithWebSearch,
  listChatProjects
} from "./chatAssistantProfiles";
import { computed, ref, shallowRef, type Ref } from "vue";
import type { AgentConversationController } from "../../composables/useAgentConversation";
import { deepwriteApi } from "../../api/deepwrite";
import { uiStorage } from "../../utils/uiStorage";

const MODE_STORAGE_KEY = "deepwrite:chat-assistant-mode:v1";
const PROJECT_STORAGE_KEY = "deepwrite:chat-assistant-project:v1";

export interface ChatAssistantProjectOption {
  key: string;
  label: string;
  project: ChatAssistantProjectRef;
  available: boolean;
}

export interface ChatAssistantModeOptions {
  conversationForKey(key: string, scope?: string): AgentConversationController;
  catalogSnapshot: Readonly<Ref<CatalogIndexSnapshot | null>>;
  longBooks: Readonly<Ref<readonly LongBookSummary[]>>;
}

function readMode(): ChatAssistantMode {
  try {
    const stored = uiStorage().getItem(MODE_STORAGE_KEY);
    return stored === "project" || stored === "roleplay" ? stored : "normal";
  } catch {
    return "normal";
  }
}

function readProject(): ChatAssistantProjectRef | null {
  try {
    const value = JSON.parse(
      uiStorage().getItem(PROJECT_STORAGE_KEY) ?? "null"
    ) as Partial<ChatAssistantProjectRef> | null;
    if (
      value &&
      (value.projectType === "short" ||
        value.projectType === "script" ||
        value.projectType === "long") &&
      typeof value.projectId === "string" &&
      value.projectId.trim()
    ) {
      return {
        projectType: value.projectType,
        projectId: value.projectId.trim()
      };
    }
  } catch {
    // Ignore damaged local UI preferences.
  }
  return null;
}

function persistPreference(
  mode: ChatAssistantMode,
  project: ChatAssistantProjectRef | null
): void {
  try {
    uiStorage().setItem(MODE_STORAGE_KEY, mode);
    if (project) {
      uiStorage().setItem(PROJECT_STORAGE_KEY, JSON.stringify(project));
    }
  } catch {
    // Local preferences are optional; the active in-memory state remains valid.
  }
}

export function useChatAssistantMode(options: ChatAssistantModeOptions) {
  const roles = useChatAssistantRoleplays();
  const mode = ref<ChatAssistantMode>(readMode());
  const selectedProject = ref<ChatAssistantProjectRef | null>(readProject());
  const configuredProjects = ref<
    ReadonlyArray<{ project: ChatAssistantProjectRef; name: string }>
  >([]);
  const controller = shallowRef<AgentConversationController | null>(null);

  const projectOptions = computed<readonly ChatAssistantProjectOption[]>(() => [
    ...(options.catalogSnapshot.value?.books ?? []).map((book) => ({
      key: projectKey({ projectType: book.bookType, projectId: book.id }),
      label: book.title,
      project: { projectType: book.bookType, projectId: book.id },
      available: true
    })),
    ...options.longBooks.value.map((book) => ({
      key: projectKey({ projectType: "long", projectId: book.id }),
      label: book.title,
      project: { projectType: "long" as const, projectId: book.id },
      available: true
    }))
  ]);

  const configuredProjectOptions = computed<
    readonly ChatAssistantProjectOption[]
  >(() =>
    configuredProjects.value.map(({ project, name }) => {
      const key = projectKey(project);
      const live = projectOptions.value.find((option) => option.key === key);
      return (
        live ?? {
          key,
          label: t("extras.chatAssistant.unavailableProject", { name: name }),
          project,
          available: false
        }
      );
    })
  );

  const selectedProjectKey = computed(() =>
    selectedProject.value ? projectKey(selectedProject.value) : ""
  );
  const selectedProjectOption = computed(
    () =>
      projectOptions.value.find(
        ({ key }) => key === selectedProjectKey.value
      ) ?? null
  );
  const selectedConfiguredProjectOption = computed(
    () =>
      configuredProjectOptions.value.find(
        ({ key }) => key === selectedProjectKey.value
      ) ?? selectedProjectOption.value
  );
  const projectAvailable = computed(
    () => mode.value !== "project" || selectedProjectOption.value !== null
  );
  const isBusy = computed(() => controller.value?.isBusy.value ?? false);
  /** The "更多功能" chat agent the next turn runs as; null when unusable. */
  function currentChatTask(): ExtrasChatTask | null {
    if (mode.value === "normal")
      return { agentId: "chat-normal", profileId: "default", input: {} };
    if (mode.value === "roleplay")
      return roles.selectedRole.value
        ? {
            agentId: "chat-roleplay",
            profileId: roles.selectedRole.value.id,
            input: {}
          }
        : null;
    if (!selectedProject.value || !projectAvailable.value) return null;
    return {
      agentId: "chat-project",
      profileId: projectKey(selectedProject.value),
      input: { project: selectedProject.value }
    };
  }
  const chatTask = computed(currentChatTask);

  function controllerIdentity(): { key: string; scope: string } {
    if (mode.value === "normal") {
      return { key: "chat-assistant:normal", scope: "assistant-chat:normal" };
    }
    if (mode.value === "roleplay")
      return {
        key: `chat-assistant:roleplay:${roles.selectedRoleId.value}`,
        scope: `assistant-chat:roleplay:${roles.selectedRoleId.value}`
      };
    const suffix = selectedProject.value
      ? projectKey(selectedProject.value)
      : "unselected";
    return {
      key: `chat-assistant:project:${suffix}`,
      scope: `assistant-chat:project:${suffix}`
    };
  }

  function activateController(): AgentConversationController {
    const identity = controllerIdentity();
    controller.value = options.conversationForKey(identity.key, identity.scope);
    return controller.value;
  }

  function setMode(nextMode: ChatAssistantMode): boolean {
    if (nextMode === mode.value) return true;
    if (isBusy.value) return false;
    mode.value = nextMode;
    persistPreference(mode.value, selectedProject.value);
    activateController();
    return true;
  }

  function selectRole(id: string): boolean {
    if (isBusy.value || !roles.select(id)) return false;
    mode.value = "roleplay";
    persistPreference(mode.value, selectedProject.value);
    activateController();
    return true;
  }

  function selectProject(key: string): boolean {
    if (isBusy.value) return false;
    const option =
      configuredProjectOptions.value.find(
        (candidate) => candidate.key === key
      ) ?? projectOptions.value.find((candidate) => candidate.key === key);
    if (!option) return false;
    selectedProject.value = option.project;
    persistPreference(mode.value, selectedProject.value);
    if (mode.value === "project") activateController();
    return true;
  }

  async function refreshConfiguredProjects(): Promise<boolean> {
    if (!deepwriteApi()) return false;
    try {
      configuredProjects.value = await listChatProjects();
      return true;
    } catch {
      return false;
    }
  }

  async function sendAssistantMessage(
    webSearchEnabled = false,
    attachments: UserPromptAttachment[] = []
  ): Promise<void> {
    const task = chatTask.value;
    if (!task || !controller.value) return;
    await controller.value.sendAssistantMessage(
      chatTaskWithWebSearch(task, webSearchEnabled),
      attachments
    );
  }

  activateController();
  void refreshConfiguredProjects();

  return {
    roleplays: roles.roleplays,
    selectedRoleId: roles.selectedRoleId,
    selectedRole: roles.selectedRole,
    saveRole: roles.save,
    selectRole,
    mode: mode as Readonly<Ref<ChatAssistantMode>>,
    selectedProject: selectedProject as Readonly<
      Ref<ChatAssistantProjectRef | null>
    >,
    selectedProjectKey,
    selectedProjectOption,
    selectedConfiguredProjectOption,
    projectOptions,
    configuredProjects: configuredProjects as Readonly<
      Ref<ReadonlyArray<{ project: ChatAssistantProjectRef; name: string }>>
    >,
    configuredProjectOptions,
    projectAvailable,
    chatTask,
    controller: controller as Readonly<Ref<AgentConversationController>>,
    isBusy,
    setMode,
    selectProject,
    refreshConfiguredProjects,
    sendAssistantMessage
  };
}

export type ChatAssistantModeFeature = ReturnType<typeof useChatAssistantMode>;
