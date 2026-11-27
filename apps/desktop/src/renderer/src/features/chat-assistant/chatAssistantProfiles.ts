import { createScopedTranslator } from "../../i18n";
import {
  CHAT_PROJECT_DEFAULT_PROFILE_ID,
  chatAssistantProjectKey
} from "@deepwrite/contracts/renderer";
import type {
  ChatAssistantProjectRef,
  ChatProjectProfile,
  ChatRoleplayProfile,
  ExtrasAgentApi,
  ExtrasChatTask
} from "@deepwrite/contracts";
import { deepwriteApi } from "../../api/deepwrite";

const t = createScopedTranslator("extras.chatAssistant");

/** A project's chat prompt as the project dialog edits it. */
export interface ChatAssistantProjectConfig {
  project: ChatAssistantProjectRef;
  systemPrompt: string;
  customized: boolean;
}

function profilesApi(): ExtrasAgentApi["profiles"] {
  const api = deepwriteApi()?.extrasAgents?.profiles;
  if (!api) throw new Error(t("desktopBridgeNotReady"));
  return api;
}

/** Drops the server-set `builtin` flag before profiles are saved back. */
function editable<P extends { builtin?: boolean | undefined }>(
  profile: P
): Omit<P, "builtin"> {
  const { builtin: _builtin, ...rest } = profile;
  return rest;
}

function upsert<P extends { id: string }>(profiles: P[], profile: P): P[] {
  const index = profiles.findIndex((candidate) => candidate.id === profile.id);
  if (index < 0) return [...profiles, profile];
  return profiles.map((candidate, at) => (at === index ? profile : candidate));
}

/** Projects configured for project chat, with the name saved for each. */
export async function listChatProjects(): Promise<
  Array<{ project: ChatAssistantProjectRef; name: string }>
> {
  const settings = await profilesApi().list("chat-project");
  return settings.profiles.flatMap((profile) =>
    profile.project ? [{ project: profile.project, name: profile.name }] : []
  );
}

function defaultProjectPrompt(profiles: readonly ChatProjectProfile[]): string {
  const fallback = profiles.find(
    (profile) => profile.id === CHAT_PROJECT_DEFAULT_PROFILE_ID
  );
  if (!fallback) throw new Error(t("defaultProjectPromptUnavailable"));
  return fallback.systemPrompt;
}

export async function readChatProjectConfig(
  project: ChatAssistantProjectRef
): Promise<ChatAssistantProjectConfig> {
  const { profiles } = await profilesApi().list("chat-project");
  const fallback = defaultProjectPrompt(profiles);
  const own = profiles.find(
    (profile) => profile.id === chatAssistantProjectKey(project)
  );
  return {
    project,
    systemPrompt: own?.systemPrompt ?? fallback,
    customized: own !== undefined && own.systemPrompt !== fallback
  };
}

/**
 * Saves a project's prompt; `null` restores the default prompt while
 * keeping the project configured.
 */
export async function saveChatProjectConfig(
  project: ChatAssistantProjectRef,
  name: string,
  systemPrompt: string | null
): Promise<ChatAssistantProjectConfig> {
  const api = profilesApi();
  const { profiles } = await api.list("chat-project");
  const fallback = defaultProjectPrompt(profiles);
  const prompt = systemPrompt ?? fallback;
  await api.save({
    agentId: "chat-project",
    profiles: upsert(profiles.map(editable), {
      id: chatAssistantProjectKey(project),
      name: name.trim().slice(0, 256) || project.projectId.slice(0, 256),
      project: { ...project },
      systemPrompt: prompt
    })
  });
  return { project, systemPrompt: prompt, customized: prompt !== fallback };
}

export async function listChatRoles(): Promise<ChatRoleplayProfile[]> {
  return (await profilesApi().list("chat-roleplay")).profiles;
}

export async function saveChatRole(
  role: Omit<ChatRoleplayProfile, "builtin">
): Promise<ChatRoleplayProfile> {
  const api = profilesApi();
  const { profiles } = await api.list("chat-roleplay");
  const saved = await api.save({
    agentId: "chat-roleplay",
    profiles: upsert(profiles.map(editable), { ...role })
  });
  const stored = saved.profiles.find((profile) => profile.id === role.id);
  if (!stored) throw new Error(t("saveCharacterFailed"));
  return stored;
}

/** The task a chat turn runs as; web search only for tool-using chats. */
export function chatTaskWithWebSearch(
  task: ExtrasChatTask,
  webSearchEnabled: boolean
): ExtrasChatTask {
  if (!webSearchEnabled) return task;
  if (task.agentId === "chat-normal")
    return { ...task, input: { ...task.input, webSearchEnabled: true } };
  if (task.agentId === "chat-project")
    return { ...task, input: { ...task.input, webSearchEnabled: true } };
  return task;
}
