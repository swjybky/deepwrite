<script setup lang="ts">
import { computed, ref } from "vue";
import AppIcon from "./AppIcon.vue";

interface SettingsCategory {
  id: string;
  label: string;
  icon?: "user" | "sparkles" | "keyboard" | "globe" | "model" | "brain";
}

interface SettingsSection {
  id: string;
  label: string;
  categories: SettingsCategory[];
}

const emit = defineEmits<{
  back: [];
}>();

const sections: SettingsSection[] = [
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
  {
    id: "coding",
    label: "编码",
    categories: [{ id: "hooks", label: "钩子" }]
  }
];

const activeCategory = ref("general");
const searchQuery = ref("");

const activeLabel = computed(() => {
  for (const section of sections) {
    const found = section.categories.find((c) => c.id === activeCategory.value);
    if (found) return found.label;
  }
  return "常规";
});

function selectCategory(id: string): void {
  activeCategory.value = id;
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
        <div
          v-for="section in sections"
          :key="section.id"
          class="settings-section"
        >
          <strong class="settings-section-label">{{ section.label }}</strong>
          <button
            v-for="category in section.categories"
            :key="category.id"
            class="settings-category"
            :class="{ 'is-active': activeCategory === category.id }"
            type="button"
            @click="selectCategory(category.id)"
          >
            <AppIcon
              v-if="category.icon"
              :name="category.icon"
              :size="15"
            />
            <span v-else class="settings-category-spacer" />
            <span>{{ category.label }}</span>
          </button>
        </div>
      </nav>
    </aside>

    <main class="settings-content">
      <h1 class="settings-title">{{ activeLabel }}</h1>

      <section v-if="activeCategory === 'general'" class="settings-group">
        <h2 class="settings-group-title">权限</h2>
        <div class="settings-card">
          <label class="settings-item">
            <span class="settings-item-text">
              <strong>默认权限</strong>
              <small>默认情况下，应用可以读取和编辑其工作空间中的文件。需要时，它可以请求额外访问权限。</small>
            </span>
            <span class="settings-toggle"><input type="checkbox" checked /></span>
          </label>
          <label class="settings-item">
            <span class="settings-item-text">
              <strong>自动审核</strong>
              <small>应用会自动审查额外访问权限请求。自动审核可能会出错。</small>
            </span>
            <span class="settings-toggle"><input type="checkbox" checked /></span>
          </label>
          <label class="settings-item">
            <span class="settings-item-text">
              <strong>完全访问权限</strong>
              <small>以完整访问权限运行时，它无需你的批准即可编辑你电脑上的任何文件。这会增加数据丢失或泄露的风险。</small>
            </span>
            <span class="settings-toggle"><input type="checkbox" checked /></span>
          </label>
        </div>

        <h2 class="settings-group-title">常规</h2>
        <div class="settings-card">
          <div class="settings-item">
            <span class="settings-item-text">
              <strong>默认文件打开目标</strong>
              <small>默认打开文件和文件夹的位置</small>
            </span>
            <button class="settings-select" type="button">Cursor</button>
          </div>
          <div class="settings-item">
            <span class="settings-item-text">
              <strong>语言</strong>
              <small>应用 UI 语言</small>
            </span>
            <button class="settings-select" type="button">自动检测</button>
          </div>
          <label class="settings-item">
            <span class="settings-item-text">
              <strong>在菜单栏中显示</strong>
              <small>关闭主窗口后，仍在菜单栏中保留应用图标</small>
            </span>
            <span class="settings-toggle"><input type="checkbox" checked /></span>
          </label>
        </div>
      </section>

      <section v-else class="settings-group">
        <div class="settings-card">
          <p class="settings-placeholder">「{{ activeLabel }}」设置项待配置。</p>
        </div>
      </section>
    </main>
  </div>
</template>

<style scoped>
.settings-page {
  display: grid;
  grid-template-columns: 280px 1fr;
  width: 100vw;
  height: 100vh;
  background: #f7f7f5;
  color: #202226;
  font-family:
    Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif;
}

.settings-sidebar {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 18px 16px;
  background: #f0f0ee;
  border-right: 1px solid #e3e3e1;
  overflow-y: auto;
}

.settings-back {
  display: flex;
  align-items: center;
  gap: 8px;
  width: fit-content;
  padding: 5px 8px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: #4a4e53;
  font-size: 13.5px;
  font-weight: 540;
  cursor: pointer;
}

.settings-back:hover {
  background: #e6e6e4;
  color: #17191c;
}

.settings-back :deep(svg) {
  transform: rotate(180deg);
}

.settings-search {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border-radius: 8px;
  background: #e8e8e6;
  color: #6a6e73;
}

.settings-search input {
  flex: 1;
  min-width: 0;
  border: 0;
  background: transparent;
  color: #202226;
  font-size: 13px;
  outline: none;
}

.settings-search input::placeholder {
  color: #8b8e92;
}

.settings-nav {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.settings-section {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.settings-section-label {
  padding: 0 8px 6px;
  color: #6a6e73;
  font-size: 11.5px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.settings-category {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 34px;
  padding: 6px 8px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: #3f4348;
  font-size: 13.5px;
  font-weight: 540;
  text-align: left;
  cursor: pointer;
}

.settings-category:hover {
  background: #e6e6e4;
  color: #17191c;
}

.settings-category.is-active {
  background: #e0e0de;
  color: #17191c;
}

.settings-category-spacer {
  width: 15px;
}

.settings-content {
  padding: 42px 56px;
  overflow-y: auto;
}

.settings-title {
  margin: 0 0 28px;
  font-size: 26px;
  font-weight: 650;
  color: #17191c;
}

.settings-group {
  max-width: 720px;
}

.settings-group-title {
  margin: 0 0 12px;
  font-size: 14px;
  font-weight: 620;
  color: #4a4e53;
}

.settings-card {
  display: flex;
  flex-direction: column;
  margin-bottom: 28px;
  padding: 6px 0;
  border-radius: 12px;
  background: #ffffff;
  box-shadow: 0 1px 2px rgba(22, 24, 27, 0.04);
}

.settings-item {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 14px 18px;
  cursor: pointer;
}

.settings-item:not(:last-child) {
  border-bottom: 1px solid #f0f0ee;
}

.settings-item-text {
  display: flex;
  flex-direction: column;
  gap: 3px;
  flex: 1;
  min-width: 0;
}

.settings-item-text strong {
  font-size: 14px;
  font-weight: 590;
  color: #202226;
}

.settings-item-text small {
  font-size: 12.5px;
  color: #6a6e73;
  line-height: 1.45;
}

.settings-toggle input {
  appearance: none;
  width: 42px;
  height: 24px;
  margin: 0;
  border-radius: 12px;
  background: #d4d4d2;
  position: relative;
  cursor: pointer;
  transition: background-color 150ms ease;
}

.settings-toggle input::after {
  content: "";
  position: absolute;
  top: 2px;
  left: 2px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #ffffff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
  transition: transform 150ms ease;
}

.settings-toggle input:checked {
  background: #4ba46a;
}

.settings-toggle input:checked::after {
  transform: translateX(18px);
}

.settings-select {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  border: 1px solid #dededb;
  border-radius: 7px;
  background: #fbfbf9;
  color: #202226;
  font-size: 13px;
  font-weight: 540;
  cursor: pointer;
}

.settings-select:hover {
  background: #f4f4f2;
}

.settings-placeholder {
  margin: 0;
  padding: 24px 18px;
  color: #6a6e73;
  font-size: 13.5px;
}
</style>
