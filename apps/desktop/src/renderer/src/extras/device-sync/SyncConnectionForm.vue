<script setup lang="ts">
import { ref } from "vue";
import type {
  SyncConfig,
  SyncRequest,
  SyncResponse,
  SyncSpace
} from "@deepwrite/contracts/renderer";
import PopupSelect from "../../components/PopupSelect.vue";
const props = defineProps<{
  config: SyncConfig | null;
  pending: boolean;
  request(input: SyncRequest): Promise<SyncResponse | null>;
}>();
const emit = defineEmits<{ done: [] }>();
const nutstore = "https://dav.jianguoyun.com/dav/";
const form = ref<SyncConfig>(
  props.config
    ? { ...props.config }
    : {
        schemaVersion: 1,
        provider: "jianguoyun",
        endpoint: nutstore,
        username: "",
        directory: "DeepWriteSync",
        spaceId: null,
        deviceName: "我的电脑",
        excludedKeys: []
      }
);
const password = ref("");
const advanced = ref(false);
const spaces = ref<SyncSpace[] | null>(null);
async function connect() {
  const result = await props.request({
    operation: "connect",
    config: { ...form.value },
    password: password.value
  });
  if (result?.kind === "spaces") {
    password.value = "";
    spaces.value = result.spaces;
  }
}
async function join(spaceId: string | null) {
  const result = await props.request({ operation: "join", spaceId });
  if (result?.kind === "status") emit("done");
}
</script>

<template>
  <section class="sync-card sync-connection">
    <template v-if="spaces">
      <h2>选择同步空间</h2>
      <p>加入另一台设备正在使用的空间，首次同步前会展示内容预览。</p>
      <button
        v-for="space in spaces"
        :key="space.id"
        class="sync-button secondary"
        :disabled="pending"
        @click="join(space.id)"
      >
        {{ space.name }}
        <small
          >{{ space.itemCount }} 项 · 最近更新
          {{ (space.lastUpdatedAt ?? space.createdAt).slice(0, 10) }}</small
        >
      </button>
      <button class="sync-button" :disabled="pending" @click="join(null)">
        建立新的写作空间
      </button>
      <button class="sync-button quiet" @click="spaces = null">
        返回连接设置
      </button>
    </template>
    <form v-else class="sync-form" @submit.prevent="connect">
      <h2>连接自己的网盘</h2>
      <p>电脑和手机使用同一空间，每次由你发起同步。</p>
      <label>网盘服务</label
      ><PopupSelect
        :model-value="form.provider"
        accessible-label="网盘服务"
        :options="[
          { value: 'jianguoyun', label: '坚果云' },
          { value: 'webdav', label: '其他 WebDAV' }
        ]"
        @update:model-value="
          (value) => {
            form.provider = value === 'jianguoyun' ? 'jianguoyun' : 'webdav';
            if (form.provider === 'jianguoyun') form.endpoint = nutstore;
          }
        "
      />
      <label v-if="form.provider === 'webdav'"
        >服务器地址<input
          v-model="form.endpoint"
          aria-label="WebDAV 服务器地址"
          autocomplete="url"
          placeholder="https://example.test/dav/"
      /></label>
      <label
        >账号<input
          v-model="form.username"
          aria-label="网盘账号"
          autocomplete="username"
      /></label>
      <label
        >应用密码<input
          v-model="password"
          aria-label="网盘应用密码"
          type="password"
          autocomplete="off"
          :placeholder="config ? '留空使用已保存的密码' : '填写网盘应用密码'"
      /></label>
      <a
        v-if="form.provider === 'jianguoyun'"
        href="https://help.jianguoyun.com/?p=2064"
        target="_blank"
        rel="noreferrer"
        >如何获取坚果云应用密码</a
      >
      <button
        type="button"
        class="sync-button quiet"
        :aria-expanded="advanced"
        @click="advanced = !advanced"
      >
        高级设置
      </button>
      <template v-if="advanced"
        ><label
          >同步目录<input
            v-model="form.directory"
            aria-label="同步目录" /></label
        ><label
          >设备名称<input
            v-model="form.deviceName"
            aria-label="设备名称" /></label
      ></template>
      <button class="sync-button" type="submit" :disabled="pending">
        {{ pending ? "正在验证连接…" : "连接并继续" }}
      </button>
    </form>
  </section>
</template>
