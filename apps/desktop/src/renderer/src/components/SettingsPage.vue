<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import type {
  LearningImitationSettings,
  LearningImitationSettingsInput,
  LearningImitationStageId,
  LibraryAgentDomain,
  LibraryAgentSettings,
  LibraryAgentSettingsInput,
  ShortWorkspaceAgentSettings,
  ShortWorkspaceAgentSettingsInput
} from "@deepwrite/contracts";
import {
  FONT_SIZE_LIMITS,
  parseThemeFile,
  serializeTheme,
  themePresets,
  useAppearance,
  type AppearanceMode,
  type ColorScheme,
  type ThemeConfig
} from "../composables/useAppearance";
import { uiMessage } from "../ui-feedback";
import AppIcon from "./AppIcon.vue";
import LearningImitationSettingsPanel from "./LearningImitationSettingsPanel.vue";
import LibraryAgentSettingsPanel from "./LibraryAgentSettingsPanel.vue";
import PopupSelect from "./PopupSelect.vue";
import ShortAgentSettingsPanel from "./ShortAgentSettingsPanel.vue";

interface SettingsCategory {
  id: string;
  label: string;
  icon?:
    | "user"
    | "sparkles"
    | "keyboard"
    | "globe"
    | "model"
    | "brain"
    | "wand"
    | "archive";
}

interface SettingsSection {
  id: string;
  label: string;
  categories: SettingsCategory[];
}

defineProps<{
  autoSaveEnabled: boolean;
  workspaceAgentSettings: ShortWorkspaceAgentSettings | null;
  workspaceAgentLoading: boolean;
  workspaceAgentSaving: boolean;
  workspaceAgentError: string | null;
  workspaceAgentStatus: string | null;
  learningImitationSettings: LearningImitationSettings | null;
  learningImitationLoading: boolean;
  learningImitationSaving: boolean;
  libraryAgentSettings: LibraryAgentSettings | null;
  libraryAgentLoading: boolean;
  libraryAgentSaving: boolean;
  runtimeAvailable: boolean;
}>();

const emit = defineEmits<{
  back: [];
  updateAutoSave: [enabled: boolean];
  saveWorkspaceAgents: [settings: ShortWorkspaceAgentSettingsInput];
  saveLearningImitation: [settings: LearningImitationSettingsInput];
  resetLearningImitation: [stageId: LearningImitationStageId];
  saveLibraryAgents: [settings: LibraryAgentSettingsInput];
  resetLibraryAgent: [domain: LibraryAgentDomain];
}>();
const appearance = useAppearance();
const activeCategory = ref("general");
const searchQuery = ref("");
const importInput = ref<HTMLInputElement | null>(null);
const accentColorInput = ref<HTMLInputElement | null>(null);
const backgroundColorInput = ref<HTMLInputElement | null>(null);
const foregroundColorInput = ref<HTMLInputElement | null>(null);
const appearanceReady = ref(false);

onMounted(() => {
  void appearance.whenReady().then(() => {
    appearanceReady.value = true;
  });
});

const sections: SettingsSection[] = [
  {
    id: "creation",
    label: "创作",
    categories: [
      { id: "short-agents", label: "创作空间配置", icon: "brain" },
      { id: "skill-library-agent", label: "技能库配置", icon: "wand" },
      { id: "material-library-agent", label: "素材库配置", icon: "archive" },
      { id: "learning-imitation", label: "学习仿写设置", icon: "sparkles" }
    ]
  },
  {
    id: "personal",
    label: "个人",
    categories: [
      { id: "general", label: "常规" },
      { id: "profile", label: "个人资料", icon: "user" },
      { id: "appearance", label: "外观", icon: "sparkles" },
      { id: "voice", label: "语音", icon: "brain" },
      { id: "configuration", label: "配置", icon: "model" },
      { id: "personalization", label: "个性化", icon: "sparkles" },
      { id: "keyboard", label: "键盘快捷键", icon: "keyboard" },
      { id: "billing", label: "使用情况和计费" },
      { id: "account", label: "账户" }
    ]
  },
  {
    id: "integration",
    label: "集成",
    categories: [
      { id: "snapshots", label: "智能快照" },
      { id: "security", label: "安全" },
      { id: "browser", label: "浏览器" },
      { id: "computer", label: "电脑操控" }
    ]
  },
  { id: "coding", label: "编码", categories: [{ id: "hooks", label: "钩子" }] }
];

const visibleSections = computed(() => {
  const query = searchQuery.value.trim().toLocaleLowerCase();
  if (!query) return sections;
  return sections
    .map((section) => ({
      ...section,
      categories: section.categories.filter((category) =>
        category.label.toLocaleLowerCase().includes(query)
      )
    }))
    .filter((section) => section.categories.length);
});

const activeLabel = computed(() => {
  for (const section of sections) {
    const found = section.categories.find((category) => category.id === activeCategory.value);
    if (found) return found.label;
  }
  return "常规";
});

const editingScheme = computed<ColorScheme>(() =>
  appearance.state.mode === "system" ? appearance.resolvedScheme.value : appearance.state.mode
);
const editingTheme = computed(() => appearance.state[editingScheme.value]);
const themeSectionTitle = computed(() => editingScheme.value === "light" ? "浅色主题" : "深色主题");
const themePresetOptions = computed(() => [
  ...(editingTheme.value.preset === "custom"
    ? [{ value: "custom", label: "自定义", disabled: true }]
    : []),
  ...themePresets.map((preset) => ({ value: preset.id, label: preset.label }))
]);

const appearanceModes: Array<{ id: AppearanceMode; label: string }> = [
  { id: "system", label: "系统" },
  { id: "light", label: "浅色" },
  { id: "dark", label: "深色" }
];

async function selectCategory(id: string): Promise<void> {
  if (id === "appearance" && !appearanceReady.value) {
    await appearance.whenReady();
    appearanceReady.value = true;
  }
  activeCategory.value = id;
}

function selectMode(mode: AppearanceMode): void {
  appearance.setMode(mode);
}

function applyThemePreset(value: string | number): void {
  appearance.applyPreset(editingScheme.value, String(value));
}

function updateTheme<K extends keyof ThemeConfig>(key: K, value: ThemeConfig[K]): void {
  appearance.updateTheme(editingScheme.value, { [key]: value });
}

type ThemeColorKey = "accent" | "background" | "foreground";
type ThemeFontSizeKey = "uiFontSize" | "codeFontSize";

function applyColor(key: ThemeColorKey, value: string): void {
  appearance.updateTheme(editingScheme.value, {
    [key]: value.trim().toUpperCase(),
    preset: "custom"
  });
}

function openColorPicker(key: ThemeColorKey): void {
  const input =
    key === "accent"
      ? accentColorInput.value
      : key === "background"
        ? backgroundColorInput.value
        : foregroundColorInput.value;
  input?.click();
}

function previewColor(key: ThemeColorKey, event: Event): void {
  const value = (event.target as HTMLInputElement).value;
  if (/^#[\da-f]{6}$/i.test(value.trim())) {
    applyColor(key, value);
  }
}

function commitColor(key: ThemeColorKey, event: Event): void {
  const input = event.target as HTMLInputElement;
  if (!/^#[\da-f]{6}$/i.test(input.value.trim())) {
    input.value = editingTheme.value[key];
    uiMessage.warning("请输入 6 位十六进制颜色，例如 #339CFF");
    return;
  }
  applyColor(key, input.value);
}

function parseFontSize(key: ThemeFontSizeKey, input: HTMLInputElement): number | null {
  if (input.value.trim() === "") return null;
  const value = Number(input.value);
  const limits = FONT_SIZE_LIMITS[key];
  return Number.isFinite(value) && value >= limits.min && value <= limits.max
    ? Math.round(value * 2) / 2
    : null;
}

function previewFontSize(key: ThemeFontSizeKey, event: Event): void {
  const value = parseFontSize(key, event.target as HTMLInputElement);
  if (value !== null) updateTheme(key, value);
}

function commitFontSize(key: ThemeFontSizeKey, event: Event): void {
  const input = event.target as HTMLInputElement;
  const value = parseFontSize(key, input);
  const limits = FONT_SIZE_LIMITS[key];
  if (value === null) {
    input.value = String(editingTheme.value[key]);
    uiMessage.warning(`字号请输入 ${limits.min}–${limits.max} px 之间的数值`);
    return;
  }
  updateTheme(key, value);
  input.value = String(value);
}

async function writeClipboard(value: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value);
    return;
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    textarea.style.pointerEvents = "none";
    document.body.append(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    if (!copied) throw new Error("Clipboard unavailable");
  }
}

async function copyTheme(): Promise<void> {
  try {
    await writeClipboard(serializeTheme(editingScheme.value));
    uiMessage.success(`${themeSectionTitle.value}配置已复制`);
  } catch {
    uiMessage.error("复制失败，请稍后重试");
  }
}

function openImport(): void {
  importInput.value?.click();
}

async function importThemeFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  try {
    const parsed = parseThemeFile(await file.text());
    const target = parsed.scheme ?? editingScheme.value;
    appearance.importTheme(target, parsed.theme);
    uiMessage.success(`已导入${target === "light" ? "浅色" : "深色"}主题`);
  } catch (error: unknown) {
    uiMessage.error(error instanceof Error ? error.message : "无法读取主题文件");
  }
}
</script>

<template>
  <div class="settings-page">
    <aside class="settings-sidebar">
      <button class="settings-back" type="button" @click="emit('back')">
        <AppIcon name="chevron" :size="14" />
        <span>返回应用</span>
      </button>

      <div class="settings-search">
        <AppIcon name="search" :size="14" />
        <input v-model="searchQuery" type="search" placeholder="搜索设置..." />
      </div>

      <nav class="settings-nav" aria-label="设置分类">
        <div v-for="section in visibleSections" :key="section.id" class="settings-section">
          <strong class="settings-section-label">{{ section.label }}</strong>
          <button
            v-for="category in section.categories"
            :key="category.id"
            class="settings-category"
            :class="{ 'is-active': activeCategory === category.id }"
            type="button"
            @click="selectCategory(category.id)"
          >
            <AppIcon v-if="category.icon" :name="category.icon" :size="15" />
            <span v-else class="settings-category-spacer" />
            <span>{{ category.label }}</span>
          </button>
        </div>
        <p v-if="!visibleSections.length" class="settings-search-empty">没有匹配的设置</p>
      </nav>
    </aside>

    <main class="settings-content">
      <div class="settings-content-inner">
        <h1 class="settings-title">{{ activeLabel }}</h1>

        <ShortAgentSettingsPanel
          v-if="activeCategory === 'short-agents'"
          :settings="workspaceAgentSettings"
          :loading="workspaceAgentLoading"
          :saving="workspaceAgentSaving"
          :error-message="workspaceAgentError"
          :status-message="workspaceAgentStatus"
          :runtime-available="runtimeAvailable"
          @save="emit('saveWorkspaceAgents', $event)"
        />

        <LearningImitationSettingsPanel
          v-else-if="activeCategory === 'learning-imitation'"
          :settings="learningImitationSettings"
          :loading="learningImitationLoading"
          :saving="learningImitationSaving"
          :runtime-available="runtimeAvailable"
          @save="emit('saveLearningImitation', $event)"
          @reset="emit('resetLearningImitation', $event)"
        />

        <LibraryAgentSettingsPanel
          v-else-if="activeCategory === 'skill-library-agent'"
          domain="skill"
          :settings="libraryAgentSettings"
          :loading="libraryAgentLoading"
          :saving="libraryAgentSaving"
          :runtime-available="runtimeAvailable"
          @save="emit('saveLibraryAgents', $event)"
          @reset="emit('resetLibraryAgent', $event)"
        />

        <LibraryAgentSettingsPanel
          v-else-if="activeCategory === 'material-library-agent'"
          domain="material"
          :settings="libraryAgentSettings"
          :loading="libraryAgentLoading"
          :saving="libraryAgentSaving"
          :runtime-available="runtimeAvailable"
          @save="emit('saveLibraryAgents', $event)"
          @reset="emit('resetLibraryAgent', $event)"
        />

        <section v-else-if="activeCategory === 'general'" class="settings-group">
          <h2 class="settings-group-title">权限</h2>
          <div class="settings-card">
            <label class="settings-item">
              <span class="settings-item-text"><strong>默认权限</strong><small>默认情况下，应用可以读取和编辑其工作空间中的文件。需要时，它可以请求额外访问权限。</small></span>
              <span class="settings-toggle"><input type="checkbox" checked /></span>
            </label>
            <label class="settings-item">
              <span class="settings-item-text"><strong>自动审核</strong><small>应用会自动审查额外访问权限请求。自动审核可能会出错。</small></span>
              <span class="settings-toggle"><input type="checkbox" checked /></span>
            </label>
            <label class="settings-item">
              <span class="settings-item-text"><strong>完全访问权限</strong><small>以完整访问权限运行时，它无需你的批准即可编辑你电脑上的任何文件。这会增加数据丢失或泄露的风险。</small></span>
              <span class="settings-toggle"><input type="checkbox" checked /></span>
            </label>
          </div>

          <h2 class="settings-group-title">常规</h2>
          <div class="settings-card">
            <label class="settings-item">
              <span class="settings-item-text"><strong>自动保存</strong><small>文稿发生变化并停止输入片刻后，自动保存到本机</small></span>
              <span class="settings-toggle"><input type="checkbox" :checked="autoSaveEnabled" @change="emit('updateAutoSave', ($event.target as HTMLInputElement).checked)" /></span>
            </label>
            <div class="settings-item"><span class="settings-item-text"><strong>默认文件打开目标</strong><small>默认打开文件和文件夹的位置</small></span><button class="settings-select" type="button">Cursor</button></div>
            <div class="settings-item"><span class="settings-item-text"><strong>语言</strong><small>应用 UI 语言</small></span><button class="settings-select" type="button">自动检测</button></div>
            <label class="settings-item"><span class="settings-item-text"><strong>在菜单栏中显示</strong><small>关闭主窗口后，仍在菜单栏中保留应用图标</small></span><span class="settings-toggle"><input type="checkbox" checked /></span></label>
          </div>
        </section>

        <section v-else-if="activeCategory === 'appearance'" class="appearance-group">
          <h2 class="appearance-heading">主题</h2>
          <div class="theme-mode-grid" role="radiogroup" aria-label="外观主题">
            <button
              v-for="mode in appearanceModes"
              :key="mode.id"
              class="theme-mode-option"
              :class="{ 'is-active': appearance.state.mode === mode.id }"
              type="button"
              role="radio"
              :aria-checked="appearance.state.mode === mode.id"
              @click="selectMode(mode.id)"
            >
              <span class="theme-preview" :class="`is-${mode.id}`" aria-hidden="true">
                <span class="preview-top-line" />
                <span class="preview-sub-line" />
                <span class="preview-window">
                  <i /><i /><i />
                </span>
              </span>
              <strong>{{ mode.label }}</strong>
            </button>
          </div>

          <div class="theme-config-card">
            <div class="theme-config-header">
              <h2>{{ themeSectionTitle }}</h2>
              <div class="theme-config-actions">
                <input ref="importInput" class="theme-file-input" type="file" accept="application/json,.json" @change="importThemeFile" />
                <button type="button" @click="openImport">导入</button>
                <button type="button" @click="copyTheme">复制主题</button>
                <PopupSelect
                  class="preset-select-control"
                  :model-value="editingTheme.preset"
                  :options="themePresetOptions"
                  accessible-label="主题预设"
                  variant="preset"
                  align="end"
                  :menu-min-width="188"
                  @update:model-value="applyThemePreset"
                >
                  <template #prefix><span class="preset-badge">Aa</span></template>
                </PopupSelect>
              </div>
            </div>

            <div class="theme-setting-row">
              <label for="accent-color">强调色</label>
              <div
                class="color-control"
                :style="{ backgroundColor: editingTheme.accent, color: '#fff' }"
                @click="openColorPicker('accent')"
              >
                <span class="color-swatch" aria-hidden="true">
                  <input
                    id="accent-color"
                    ref="accentColorInput"
                    type="color"
                    :value="editingTheme.accent.toLowerCase()"
                    aria-label="选择强调色"
                    @click.stop
                    @input="applyColor('accent', ($event.target as HTMLInputElement).value)"
                  />
                </span>
                <input
                  :value="editingTheme.accent"
                  aria-label="输入强调色"
                  spellcheck="false"
                  @click.stop
                  @input="previewColor('accent', $event)"
                  @change="commitColor('accent', $event)"
                />
              </div>
            </div>
            <div class="theme-setting-row">
              <label for="background-color">背景</label>
              <div
                class="color-control"
                :class="{ 'is-light': editingScheme === 'light' }"
                :style="{ backgroundColor: editingTheme.background, color: editingTheme.foreground }"
                @click="openColorPicker('background')"
              >
                <span class="color-swatch" aria-hidden="true">
                  <input
                    id="background-color"
                    ref="backgroundColorInput"
                    type="color"
                    :value="editingTheme.background.toLowerCase()"
                    aria-label="选择背景色"
                    @click.stop
                    @input="applyColor('background', ($event.target as HTMLInputElement).value)"
                  />
                </span>
                <input
                  :value="editingTheme.background"
                  aria-label="输入背景色"
                  spellcheck="false"
                  @click.stop
                  @input="previewColor('background', $event)"
                  @change="commitColor('background', $event)"
                />
              </div>
            </div>
            <div class="theme-setting-row">
              <label for="foreground-color">前景</label>
              <div
                class="color-control"
                :class="{ 'is-light': editingScheme === 'light' }"
                :style="{ backgroundColor: editingTheme.foreground, color: editingTheme.background }"
                @click="openColorPicker('foreground')"
              >
                <span class="color-swatch" aria-hidden="true">
                  <input
                    id="foreground-color"
                    ref="foregroundColorInput"
                    type="color"
                    :value="editingTheme.foreground.toLowerCase()"
                    aria-label="选择前景色"
                    @click.stop
                    @input="applyColor('foreground', ($event.target as HTMLInputElement).value)"
                  />
                </span>
                <input
                  :value="editingTheme.foreground"
                  aria-label="输入前景色"
                  spellcheck="false"
                  @click.stop
                  @input="previewColor('foreground', $event)"
                  @change="commitColor('foreground', $event)"
                />
              </div>
            </div>
            <div class="theme-setting-row">
              <label for="ui-font-size">UI 字号</label>
              <div class="font-size-control">
                <input id="ui-font-size" type="number" :min="FONT_SIZE_LIMITS.uiFontSize.min" :max="FONT_SIZE_LIMITS.uiFontSize.max" step="0.5" :value="editingTheme.uiFontSize" :placeholder="String(editingTheme.uiFontSize)" inputmode="decimal" required aria-label="UI 字号（像素）" @input="previewFontSize('uiFontSize', $event)" @change="commitFontSize('uiFontSize', $event)" />
                <span>px</span>
              </div>
            </div>
            <div class="theme-setting-row">
              <label for="code-font-size">代码字号</label>
              <div class="font-size-control is-code">
                <input id="code-font-size" type="number" :min="FONT_SIZE_LIMITS.codeFontSize.min" :max="FONT_SIZE_LIMITS.codeFontSize.max" step="0.5" :value="editingTheme.codeFontSize" :placeholder="String(editingTheme.codeFontSize)" inputmode="decimal" required aria-label="代码字号（像素）" @input="previewFontSize('codeFontSize', $event)" @change="commitFontSize('codeFontSize', $event)" />
                <span>px</span>
              </div>
            </div>
            <label class="theme-setting-row is-toggle">
              <span>半透明侧边栏</span>
              <span class="settings-toggle"><input type="checkbox" :checked="editingTheme.translucentSidebar" @change="updateTheme('translucentSidebar', ($event.target as HTMLInputElement).checked)" /></span>
            </label>
          </div>
        </section>

        <section v-else class="settings-group">
          <div class="settings-card"><p class="settings-placeholder">「{{ activeLabel }}」设置项待配置。</p></div>
        </section>
      </div>
    </main>
  </div>
</template>

<style scoped>
.settings-page {
  display: grid;
  grid-template-columns: 256px 1fr;
  width: 100vw;
  height: 100vh;
  background: var(--surface-main);
  color: var(--text-primary);
  font-family: var(--ui-font);
}

.settings-sidebar {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 18px 14px;
  border-right: 1px solid var(--theme-line-soft);
  background: var(--sidebar-surface);
  overflow-y: auto;
}

:global(html[data-platform="darwin"] .settings-sidebar) {
  padding-top: 40px;
  -webkit-app-region: drag;
}

:global(html[data-platform="darwin"] .settings-sidebar) :is(button, input, a, .settings-nav) {
  -webkit-app-region: no-drag;
}

:global(html[data-translucent-sidebar="true"] .settings-sidebar) { backdrop-filter: blur(22px) saturate(1.25); }

.settings-back, .settings-category, .theme-config-actions button {
  border: 0;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}

.settings-back { display: flex; align-items: center; gap: 8px; width: fit-content; padding: 5px 8px; border-radius: 7px; font-size: 0.928571rem; font-weight: 560; }
.settings-back:hover, .settings-category:hover { background: var(--surface-hover); color: var(--text-primary); }
.settings-back :deep(svg) { transform: rotate(180deg); }

.settings-search { display: flex; align-items: center; gap: 8px; padding: 7px 10px; border-radius: 8px; background: var(--surface-muted); color: var(--text-tertiary); }
.settings-search input { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; color: var(--text-primary); font-size: 0.928571rem; }
.settings-search input::placeholder { color: var(--text-tertiary); }
.settings-nav { display: flex; flex-direction: column; gap: 18px; }
.settings-section { display: flex; flex-direction: column; gap: 2px; }
.settings-section-label { padding: 0 8px 6px; color: var(--text-tertiary); font-size: 0.821429rem; font-weight: 620; letter-spacing: .03em; }
.settings-category { display: flex; align-items: center; gap: 10px; width: 100%; min-height: 34px; padding: 6px 8px; border-radius: 7px; font-size: 0.964286rem; font-weight: 540; text-align: left; }
.settings-category.is-active { background: var(--surface-selected); color: var(--text-primary); }
.settings-category-spacer { width: 15px; }
.settings-search-empty { padding: 16px 8px; color: var(--text-tertiary); font-size: 0.928571rem; }

.settings-content { overflow-y: auto; padding: 52px clamp(42px, 7vw, 112px) 80px; }
.settings-content-inner { width: min(100%, 1060px); margin: 0 auto; }
.settings-title { margin: 0 0 60px; color: var(--text-primary); font-size: 2.57143rem; font-weight: 520; letter-spacing: -.035em; }
.settings-group { max-width: 760px; }
.settings-group-title, .appearance-heading { margin: 0 0 14px; color: var(--text-primary); font-size: 1.07143rem; font-weight: 640; }
.settings-card { display: flex; flex-direction: column; margin-bottom: 28px; padding: 6px 0; border: 1px solid var(--theme-line-soft); border-radius: 13px; background: var(--surface-raised); }
.settings-item { display: flex; align-items: center; gap: 16px; padding: 14px 18px; cursor: pointer; }
.settings-item:not(:last-child) { border-bottom: 1px solid var(--theme-line-soft); }
.settings-item-text { display: flex; flex: 1; flex-direction: column; gap: 3px; min-width: 0; }
.settings-item-text strong { color: var(--text-primary); font-size: 1rem; font-weight: 590; }
.settings-item-text small { color: var(--text-secondary); font-size: 0.892857rem; line-height: 1.45; }

.settings-toggle input { position: relative; width: 42px; height: 24px; margin: 0; appearance: none; border-radius: 12px; background: var(--surface-selected); cursor: pointer; transition: background-color 150ms ease; }
.settings-toggle input::after { position: absolute; top: 2px; left: 2px; width: 20px; height: 20px; border-radius: 50%; background: var(--surface-main); box-shadow: 0 1px 3px rgb(0 0 0 / .22); content: ""; transition: transform 150ms ease; }
.settings-toggle input:checked { background: var(--accent); }
.settings-toggle input:checked::after { transform: translateX(18px); }
.settings-select { padding: 5px 10px; border: 1px solid var(--theme-line); border-radius: 7px; background: var(--surface-raised); color: var(--text-primary); cursor: pointer; }
.settings-placeholder { padding: 24px 18px; color: var(--text-secondary); font-size: 0.964286rem; }

.appearance-group { width: 100%; }
.theme-mode-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 22px; margin-bottom: 40px; }
.theme-mode-option { min-width: 0; padding: 0; border: 0; background: transparent; color: var(--text-secondary); cursor: pointer; }
.theme-mode-option strong { display: block; padding-top: 11px; font-size: 1.14286rem; font-weight: 590; }
.theme-mode-option.is-active { color: var(--text-primary); }
.theme-preview { position: relative; display: block; height: 150px; overflow: hidden; border: 1px solid var(--theme-line); border-radius: 15px; background: #f3f3f3; transition: box-shadow 150ms ease, border-color 150ms ease, transform 150ms ease; }
.theme-mode-option:hover .theme-preview { transform: translateY(-2px); box-shadow: 0 10px 28px rgb(0 0 0 / .08); }
.theme-mode-option.is-active .theme-preview { border: 2px solid var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
.theme-preview.is-dark { background: #5b5b5b; }
.theme-preview.is-system { background: linear-gradient(90deg, #f2f2f2 0 50%, #555 50%); }
.preview-top-line, .preview-sub-line { position: absolute; left: 50%; height: 7px; border-radius: 5px; background: #c9c9c9; transform: translateX(-50%); }
.preview-top-line { top: 32px; width: 44%; }
.preview-sub-line { top: 48px; width: 62%; height: 5px; opacity: .7; }
.theme-preview.is-dark .preview-top-line, .theme-preview.is-dark .preview-sub-line { background: #aaa; }
.preview-window { position: absolute; right: 9%; bottom: -4px; left: 9%; height: 88px; padding: 18px 13px; border-radius: 13px 13px 0 0; background: rgb(255 255 255 / .94); box-shadow: 0 -1px 0 rgb(0 0 0 / .08); }
.theme-preview.is-system .preview-window { background: linear-gradient(90deg, rgb(255 255 255 / .95) 0 50%, #303030 50%); }
.preview-window i { display: block; width: 38%; height: 7px; margin-bottom: 11px; border-radius: 5px; background: #d9d9d9; }
.preview-window i:nth-child(2) { width: 62%; }.preview-window i:nth-child(3) { width: 78%; }

.theme-config-card { border: 1px solid var(--theme-line-soft); border-radius: 17px; background: var(--surface-raised); box-shadow: 0 1px 3px color-mix(in srgb, var(--theme-foreground) 4%, transparent); }
.theme-config-header, .theme-setting-row { display: flex; align-items: center; min-height: 62px; padding: 0 22px; border-bottom: 1px solid var(--theme-line-soft); }
.theme-config-header { justify-content: space-between; gap: 24px; min-height: 70px; }
.theme-config-header h2 { margin: 0; font-size: 1.14286rem; font-weight: 640; }
.theme-config-actions { display: flex; align-items: center; gap: 8px; }
.theme-config-actions > button { padding: 8px 10px; font-size: 1rem; font-weight: 560; }
.theme-config-actions > button:hover { color: var(--text-primary); }
.theme-file-input { display: none; }
.preset-select-control { min-width: 188px; }
.preset-badge { display: grid; place-items: center; width: 28px; height: 28px; border: 1px solid var(--theme-line); border-radius: 8px; color: var(--accent); font-size: 1.21429rem; font-weight: 650; }
.theme-setting-row { justify-content: space-between; gap: 32px; font-size: 1.07143rem; font-weight: 580; }
.theme-setting-row:last-child { border-bottom: 0; }
.color-control { display: flex; align-items: center; width: 190px; height: 38px; padding: 0 10px; border: 1px solid rgb(127 127 127 / .18); border-radius: 11px; cursor: pointer; }
.color-swatch { position: relative; display: grid; place-items: center; width: 22px; height: 22px; overflow: hidden; border: 1px solid currentColor; border-radius: 50%; flex-shrink: 0; }
.color-control input[type="color"] { position: absolute; inset: -4px; width: calc(100% + 8px); height: calc(100% + 8px); padding: 0; border: 0; border-radius: 0; background: transparent; cursor: pointer; opacity: 1; }
.color-control input[type="color"]::-webkit-color-swatch-wrapper { padding: 0; }
.color-control input[type="color"]::-webkit-color-swatch { border: 0; border-radius: 0; }
.color-control input:not([type="color"]) { width: 110px; margin-left: 8px; border: 0; outline: 0; background: transparent; color: inherit; font-size: 1rem; font-weight: 570; text-transform: uppercase; cursor: text; }
.font-size-control { display: flex; align-items: center; width: 112px; padding: 0 11px; border: 1px solid var(--theme-line); border-radius: 10px; background: var(--surface-main); color: var(--text-tertiary); }
.font-size-control:focus-within { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
.font-size-control input { width: 100%; min-width: 0; padding: 8px 0; border: 0; outline: 0; background: transparent; color: var(--text-secondary); font-size: 0.964286rem; font-weight: 570; }
.font-size-control span { padding-left: 7px; font-size: 0.857143rem; }
.font-size-control.is-code input { font-family: var(--code-font); }

@media (max-width: 1100px) {
  .settings-page { grid-template-columns: 230px 1fr; }
  .settings-content { padding-right: 36px; padding-left: 36px; }
  .theme-preview { height: 125px; }
  .theme-config-header { align-items: flex-start; flex-direction: column; padding-top: 16px; padding-bottom: 16px; }
}
</style>
