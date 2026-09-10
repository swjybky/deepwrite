<script setup lang="ts">
import { computed, ref } from "vue";
import type { SyncStatus } from "@deepwrite/contracts/renderer";
import { syncPresentation } from "./presentation";
const props = defineProps<{ status: SyncStatus }>();
const expanded = ref(false);
const view = computed(() => syncPresentation(props.status));
const first = computed(() =>
  props.status.issues.find((issue) => issue.reason === "first-sync")
);
const groups = computed(() =>
  [
    { title: "本机修改 · 待上传到远端", items: view.value.uploads },
    { title: "远端更新 · 待下载到本机", items: view.value.downloads },
    { title: "两端都有修改 · 需要合并", items: view.value.both }
  ].filter((group) => group.items.length)
);
</script>
<template>
  <section v-if="!status.firstSyncConfirmed" class="sync-card">
    <h2>首次同步预览</h2>
    <p>
      {{
        first?.message ?? "首次对齐本机与远端，之后只显示待上传和待下载的变化。"
      }}
    </p>
    <template v-if="first">
      <p>
        点击上方“确认并开始首次同步”才会传输。同一作品按身份合并，两端冲突会单独确认。
      </p>
      <button
        class="sync-button quiet"
        :aria-expanded="expanded"
        @click="expanded = !expanded"
      >
        {{ expanded ? "收起完整清单" : `查看全部 ${first.paths.length} 项` }}
      </button>
      <ul v-if="expanded">
        <li v-for="(title, index) in first.paths" :key="index">{{ title }}</li>
      </ul>
    </template>
  </section>
  <template v-else>
    <section v-for="group in groups" :key="group.title" class="sync-card">
      <h2>{{ group.title }}</h2>
      <div v-for="item in group.items" :key="item.key" class="sync-list-row">
        {{ item.title }}
      </div>
    </section>
    <p v-if="!groups.length && !view.problems.length">
      没有待同步的变化。已同步内容可在“同步范围”中查看。
    </p>
  </template>
</template>
