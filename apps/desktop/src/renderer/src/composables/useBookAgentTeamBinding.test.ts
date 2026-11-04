import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSettingsStore } from "../stores/settingsStore";
import { uiMessage } from "../ui-feedback";
import {
  bindCreatedBookAgentTeams,
  copyBookAgentTeamBinding
} from "./useBookAgentTeamBinding";

const snapshot = (bookBindings?: Record<string, string[]>) =>
  ({
    enabledTeamIds: {},
    teams: [],
    ...(bookBindings ? { bookBindings } : {})
  }) as never;
const agentTeams = { list: vi.fn(), setBookBinding: vi.fn() };

beforeEach(() => {
  setActivePinia(createPinia());
  vi.stubGlobal("window", { deepwrite: { agentTeams } });
  agentTeams.list.mockReset();
  agentTeams.setBookBinding.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("bindCreatedBookAgentTeams", () => {
  it("does nothing for a book created without teams", async () => {
    await bindCreatedBookAgentTeams("book", "short", undefined);
    await bindCreatedBookAgentTeams("book", "short", []);

    expect(agentTeams.setBookBinding).not.toHaveBeenCalled();
  });

  it("saves the binding and refreshes the catalog", async () => {
    agentTeams.setBookBinding.mockResolvedValue(snapshot({ book: ["team"] }));

    await bindCreatedBookAgentTeams("book", "long", ["team"]);

    expect(agentTeams.setBookBinding).toHaveBeenCalledWith({
      bookId: "book",
      workspaceType: "long",
      teamIds: ["team"]
    });
    expect(useSettingsStore().agentTeamCatalog?.bookBindings).toEqual({
      book: ["team"]
    });
  });

  it("warns without failing when the book exists but binding fails", async () => {
    const warning = vi.spyOn(uiMessage, "warning").mockImplementation(vi.fn());
    agentTeams.setBookBinding.mockRejectedValue(new Error("磁盘已满"));

    await expect(
      bindCreatedBookAgentTeams("book", "short", ["team"])
    ).resolves.toBeUndefined();
    expect(warning).toHaveBeenCalledOnce();
  });
});

describe("copyBookAgentTeamBinding", () => {
  it("gives a copy its source's teams", async () => {
    agentTeams.list.mockResolvedValue(snapshot({ source: ["a", "b"] }));
    agentTeams.setBookBinding.mockResolvedValue(snapshot());

    await copyBookAgentTeamBinding("source", "copy", "script");

    expect(agentTeams.setBookBinding).toHaveBeenCalledWith({
      bookId: "copy",
      workspaceType: "script",
      teamIds: ["a", "b"]
    });
  });

  it("leaves a copy of an unbound book unbound", async () => {
    agentTeams.list.mockResolvedValue(snapshot());

    await copyBookAgentTeamBinding("source", "copy", "short");

    expect(agentTeams.setBookBinding).not.toHaveBeenCalled();
  });
});
