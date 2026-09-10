<script setup lang="ts">
import { computed, ref } from "vue";
import {
  resolveSyncVersion,
  syncVersionPreview,
  type SyncIssue,
  type SyncItem
} from "@deepwrite/contracts/renderer";
const props = defineProps<{ issue: SyncIssue; pending: boolean }>();
const emit = defineEmits<{ resolve: [item: SyncItem | null] }>();
const expanded = ref(false);
const drafts = ref<Record<string, string>>({});
const versions = computed(() => [
  { deviceName: "本机版本", item: props.issue.local },
  ...props.issue.versions
]);
const editable = computed(
  () =>
    props.issue.reason === "conflict" &&
    props.issue.local &&
    props.issue.paths.every((path) => path.endsWith(".md"))
);
function edit(path: string, event: Event) {
  if (event.target instanceof HTMLTextAreaElement)
    drafts.value[path] = event.target.value;
}
function saveMerged() {
  if (props.issue.local)
    emit(
      "resolve",
      resolveSyncVersion(props.issue, {
        ...props.issue.local,
        files: { ...props.issue.local.files, ...drafts.value }
      })
    );
}
</script>
<template>
  <section class="sync-card">
    <h3>{{ issue.title }}</h3>
    <p>{{ issue.message }}</p>
    <p v-if="!issue.token && issue.paths.length">
      涉及文件：{{ issue.paths.join("、") }}
    </p>
    <button
      v-if="issue.token"
      class="sync-button secondary"
      :aria-expanded="expanded"
      @click="expanded = !expanded"
    >
      {{ expanded ? "收起版本" : "查看并处理" }}
    </button>
    <template v-if="expanded">
      <div class="sync-versions">
        <section v-for="(version, index) in versions" :key="index">
          <h4>{{ version.deviceName }}</h4>
          <div v-for="path in issue.paths" :key="path">
            <strong>{{
              path.endsWith(".json") ? "作品结构与设定" : path
            }}</strong>
            <pre>{{
              syncVersionPreview(
                version.item,
                path,
                index === 0 ? issue.versions[0]?.item : issue.local
              )
            }}</pre>
          </div>
          <button
            class="sync-button"
            :disabled="pending"
            @click="emit('resolve', resolveSyncVersion(issue, version.item))"
          >
            {{
              issue.reason === "delete"
                ? index === 0
                  ? "保留并恢复到双端"
                  : "确认同步删除"
                : version.item
                  ? "采用此版本并同步"
                  : "确认同步删除"
            }}
          </button>
        </section>
      </div>
      <template v-if="editable"
        ><label v-for="path in issue.paths" :key="path"
          >编辑合并结果 · {{ path
          }}<textarea
            :value="drafts[path] ?? issue.local?.files[path] ?? ''"
            @input="edit(path, $event)"
          />
        </label>
        <button
          class="sync-button"
          :disabled="pending || !Object.keys(drafts).length"
          @click="saveMerged"
        >
          采用合并结果并同步
        </button></template
      >
      <button class="sync-button quiet" @click="expanded = false">
        稍后处理
      </button>
    </template>
  </section>
</template>
