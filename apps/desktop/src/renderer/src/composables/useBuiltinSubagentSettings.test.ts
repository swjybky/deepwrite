import { createPinia, setActivePinia } from "pinia";
import { afterEach, expect, it, vi } from "vitest";
import {
  AgentTeamCatalogSnapshotSchema,
  DEFAULT_AGENT_TEAM_SETTINGS,
  type AgentTeamCatalogSnapshot,
  type BuiltinSubagentSettings
} from "@deepwrite/contracts";
import { useSettingsStore } from "../stores/settingsStore";
import { uiMessage } from "../ui-feedback";
import { useBuiltinSubagentSettings } from "./useBuiltinSubagentSettings";

vi.mock("../ui-feedback", () => ({
  uiMessage: { error: vi.fn(), success: vi.fn() }
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<Value>((pass, fail) => {
    resolve = pass;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function harness() {
  setActivePinia(createPinia());
  const store = useSettingsStore();
  const initial = AgentTeamCatalogSnapshotSchema.parse({
    teams: [
      {
        id: "default",
        name: "Default",
        workspaceType: "short",
        settings: DEFAULT_AGENT_TEAM_SETTINGS
      }
    ],
    enabledTeamIds: {}
  });
  store.markLoaded("agentTeams", initial);
  const agentTeams = {
    saveBuiltins: vi.fn(async (builtinSubagents: BuiltinSubagentSettings) => ({
      ...initial,
      builtinSubagents
    })),
    list: vi.fn(async () => initial)
  };
  vi.stubGlobal("window", { deepwrite: { agentTeams } });
  return {
    store,
    initial,
    agentTeams,
    controls: useBuiltinSubagentSettings()
  };
}

it("toggles immediately, preserves invocation guidance and keeps the page available", async () => {
  const { store, initial, agentTeams, controls } = harness();
  const reply = deferred<AgentTeamCatalogSnapshot>();
  agentTeams.saveBuiltins.mockReturnValueOnce(reply.promise);

  const pending = controls.setEnabled("skill", true);
  expect(store.agentTeamCatalog!.builtinSubagents.skill.enabled).toBe(true);
  expect(store.agentTeamSaving).toBe(false);
  expect(agentTeams.saveBuiltins).toHaveBeenCalledWith({
    ...initial.builtinSubagents,
    skill: { ...initial.builtinSubagents.skill, enabled: true }
  });
  const saved = store.agentTeamCatalog!;
  store.markLoaded("agentTeams", {
    ...saved,
    enabledTeamIds: { short: "default" }
  });
  reply.resolve(saved);
  await pending;
  expect(store.agentTeamCatalog!.builtinSubagents).toEqual(
    saved.builtinSubagents
  );
  expect(store.agentTeamCatalog!.enabledTeamIds).toEqual({ short: "default" });
  expect(store.agentTeamSaving).toBe(false);
});

it("restores authoritative settings and reports a rejected toggle", async () => {
  const { store, initial, agentTeams, controls } = harness();
  agentTeams.saveBuiltins.mockRejectedValueOnce(new Error("test failure"));

  await controls.setEnabled("skill", true);

  expect(agentTeams.list).toHaveBeenCalledOnce();
  expect(store.agentTeamCatalog!.builtinSubagents).toEqual(
    initial.builtinSubagents
  );
  expect(store.agentTeamSaving).toBe(false);
  expect(uiMessage.error).toHaveBeenCalledOnce();
  expect(uiMessage.success).not.toHaveBeenCalled();
});

it("retains rapid changes across tools and ignores older save replies", async () => {
  const { store, initial, agentTeams, controls } = harness();
  const first = deferred<AgentTeamCatalogSnapshot>();
  const second = deferred<AgentTeamCatalogSnapshot>();
  const third = deferred<AgentTeamCatalogSnapshot>();
  agentTeams.saveBuiltins
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise)
    .mockReturnValueOnce(third.promise);

  const one = controls.setEnabled("skill", true);
  const firstSnapshot = store.agentTeamCatalog!;
  const two = controls.setEnabled("material", true);
  const secondSnapshot = store.agentTeamCatalog!;
  const three = controls.setEnabled("skill", false);
  const finalSnapshot = store.agentTeamCatalog!;
  expect(finalSnapshot.builtinSubagents).toEqual({
    ...initial.builtinSubagents,
    material: { ...initial.builtinSubagents.material, enabled: true }
  });
  expect(agentTeams.saveBuiltins).toHaveBeenLastCalledWith(
    finalSnapshot.builtinSubagents
  );

  third.resolve(finalSnapshot);
  await three;
  second.resolve(secondSnapshot);
  await two;
  first.resolve(firstSnapshot);
  await one;
  expect(store.agentTeamCatalog!.builtinSubagents).toEqual(
    finalSnapshot.builtinSubagents
  );
});

it("ignores an outdated error refresh after a newer toggle succeeds", async () => {
  const { store, initial, agentTeams, controls } = harness();
  const refresh = deferred<AgentTeamCatalogSnapshot>();
  agentTeams.saveBuiltins.mockRejectedValueOnce(new Error("test failure"));
  agentTeams.list.mockReturnValueOnce(refresh.promise);
  const first = controls.setEnabled("skill", true);
  await Promise.resolve();
  expect(agentTeams.list).toHaveBeenCalledOnce();

  await controls.setEnabled("team", true);
  const latest = store.agentTeamCatalog!;
  refresh.resolve(initial);
  await first;
  expect(store.agentTeamCatalog!.builtinSubagents).toEqual(
    latest.builtinSubagents
  );
  expect(store.agentTeamCatalog!.builtinSubagents.team.enabled).toBe(true);
});

it("restores the previous settings when both save and refresh fail", async () => {
  const { store, initial, agentTeams, controls } = harness();
  agentTeams.saveBuiltins.mockRejectedValueOnce(new Error("save failure"));
  agentTeams.list.mockRejectedValueOnce(new Error("refresh failure"));

  await controls.setEnabled("skill", true);

  expect(store.agentTeamCatalog!.builtinSubagents).toEqual(
    initial.builtinSubagents
  );
});

it("ignores toggles during an explicit catalog save", async () => {
  const { store, initial, agentTeams, controls } = harness();
  store.agentTeamSaving = true;

  await controls.setEnabled("skill", true);

  expect(agentTeams.saveBuiltins).not.toHaveBeenCalled();
  expect(store.agentTeamCatalog!.builtinSubagents).toEqual(
    initial.builtinSubagents
  );
});
