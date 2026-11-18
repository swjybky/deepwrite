import { describe, expect, it } from "vitest";
import source from "./AgentTeamCatalogFeature.vue?raw";
import listSource from "./AgentTeamCatalogList.vue?raw";
import dialogsSource from "./AgentTeamCatalogDialogs.vue?raw";

describe("AgentTeamCatalogFeature", () => {
  it("opens with a catalog and keeps the editor behind team selection", () => {
    expect(source).toContain("<AgentTeamCatalogList");
    expect(source).toContain('v-if="selectedTeam"');
    expect(source).toContain("<AgentTeamSettingsPanel");
    expect(source).toContain('@select="selectedTeamId = $event"');
    expect(source).toContain("backToTeams");
    expect(listSource).toContain('class="team-catalog"');
    expect(listSource).toContain("emit('select', team.id)");
  });

  it("supports per-type selection toggles and protected deletion", () => {
    expect(listSource).toContain("<AgentTeamSwitch");
    expect(listSource).toContain(
      "emit('setEnabled', { teamId: team.id, enabled: $event })"
    );
    expect(listSource).toContain(
      "props.catalog?.enabledTeamIds[team.workspaceType] === team.id"
    );
    expect(listSource).toContain(':disabled="busy || isEnabled(team)"');
    expect(dialogsSource).toContain("deleteMessage");
    expect(dialogsSource).toContain("dialog-primary-button is-danger");
  });

  it("keeps the catalog order when a team is enabled and filters only by type", () => {
    expect(listSource).toContain(
      "const teams = computed(() => props.catalog?.teams ?? [])"
    );
    expect(listSource).toContain('v-for="team in visibleTeams"');
    expect(listSource).toContain("team.workspaceType === typeFilter.value");
    expect(listSource).not.toContain("Number(isEnabled(right))");
  });

  it("shows which team is active for each writing type", () => {
    expect(listSource).toMatch(
      /const WORKSPACE_TYPES = \[\s*"short",\s*"script",\s*"long",\s*"academic",\s*"mystery"\s*\]/
    );
    expect(listSource).toContain('class="active-strip"');
    expect(listSource).toContain("notEnabled");
  });

  it("creates blank named profiles through the catalog API without auto activation", () => {
    expect(source).toContain('emit("create", input)');
    expect(source).toContain("pendingExistingTeamIds");
    const submitCreate = source.slice(
      source.indexOf("function submitCreate"),
      source.indexOf("function submitRename")
    );
    expect(submitCreate).not.toContain("setEnabled");
    expect(dialogsSource).toContain("<PopupSelect");
    expect(dialogsSource).toContain(':menu-z-index="230"');
    expect(dialogsSource).toContain('uiMessage.warning(t("enterATeamName"))');
  });

  it("resets detail state whenever the primary navigation is activated", () => {
    expect(source).toContain("() => props.navigationEpoch");
    expect(source).toContain("selectedTeamId.value = null");
    expect(source).toContain('emit("authoringReset")');
  });

  it("renders the list and the editor inside one shared page container", () => {
    expect(source).toContain('<AppIcon name="arrow-left" :size="15" />');
    expect(source).toContain('class="team-page team-detail"');
    expect(source).toContain('<div v-else class="team-page">');
    // The back button is the first element of the editor page, not a padded
    // navigation bar that sits at a different inset than the content below.
    expect(source).not.toContain("detail-navigation");
    expect(source.indexOf('class="back-button"')).toBeLessThan(
      source.indexOf('class="detail-header"')
    );
    expect(source.indexOf('class="detail-header"')).toBeLessThan(
      source.indexOf("<AgentTeamSettingsPanel")
    );
  });

  it("lets the user enable the open team without leaving its editor", () => {
    expect(source).toContain('class="detail-enable"');
    expect(source).toContain("<AgentTeamSwitch");
    expect(source).toContain(
      "emit('setEnabled', { teamId: selectedTeam.id, enabled: $event })"
    );
  });

  it("asks before leaving a team with unsaved edits", () => {
    expect(source).toContain('@dirty-change="editorDirty = $event"');
    expect(source).toContain('openDialog("leave"');
    expect(source).toContain("if (editorDirty.value)");
    expect(source).toContain("watch(selectedTeamId, () => {");
    expect(dialogsSource).toContain("confirmLeave");
    expect(dialogsSource).toContain("discardAndLeave");
    expect(dialogsSource).not.toMatch(/mode === 'leave'[^>]*is-danger/);
  });

  it("downloads each complete team and installs uploaded team archives", () => {
    expect(listSource).toContain("installTeam");
    expect(listSource).toContain("emit('install')");
    expect(listSource).toContain("emit('download', team.id)");
    expect(listSource).toContain('<AppIcon name="download"');
    expect(source).toContain("emit('download', { teamId: $event })");
  });
});
