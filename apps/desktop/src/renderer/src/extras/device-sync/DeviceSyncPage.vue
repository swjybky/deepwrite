<script setup lang="ts">
import { ref } from "vue";
import QRCode from "qrcode/lib/browser.js";
import type { SyncHistory } from "@deepwrite/contracts/renderer";
import AppIcon from "../../components/AppIcon.vue";
import { useDeviceSync } from "./useDeviceSync";
import SyncConnectionForm from "./SyncConnectionForm.vue";
import SyncConflictCard from "./SyncConflictCard.vue";
import SyncStatusCard from "./SyncStatusCard.vue";
import SyncChangesPanel from "./SyncChangesPanel.vue";
import { uiMessage } from "../../ui-feedback";
import "./device-sync.css";
const props = defineProps<{
  prepareSync(): Promise<boolean>;
  refreshSync(): Promise<void>;
}>();
const { status, pending, run } = useDeviceSync(
  props.refreshSync,
  props.prepareSync
);
const tab = ref("overview");
const qr = ref("");
const restoring = ref<Omit<SyncHistory, "item"> | null>(null);
const tabs = [
  { id: "overview", label: "待同步" },
  { id: "content", label: "同步范围" },
  { id: "devices", label: "设备" },
  { id: "history", label: "历史与恢复" },
  { id: "connection", label: "连接设置" }
];
async function connectPhone() {
  const result = await run({ operation: "code" });
  if (result?.kind !== "code") return;
  try {
    qr.value = await QRCode.toDataURL(result.code, {
      width: 256,
      margin: 2,
      errorCorrectionLevel: "M"
    });
  } catch {
    uiMessage.error("无法生成接入码，请在手机上手动配置。");
  }
}
function changeIncluded(key: string, event: Event) {
  if (event.target instanceof HTMLInputElement)
    void toggle(key, event.target.checked);
}
async function toggle(key: string, included: boolean) {
  const config = status.value?.config;
  if (!config) return;
  const excluded = new Set(config.excludedKeys);
  if (included) excluded.delete(key);
  else excluded.add(key);
  await run({
    operation: "configure",
    config: { ...config, excludedKeys: [...excluded] }
  });
}
async function restore() {
  const entry = restoring.value;
  if (!entry) return;
  restoring.value = null;
  await run({ operation: "restore", historyId: entry.id });
}
</script>
<template>
  <section class="device-sync-page" aria-label="双端同步">
    <header class="sync-page-heading">
      <div>
        <p class="sync-eyebrow">自己的网盘 · 连续的创作</p>
        <h1>双端同步</h1>
        <p>在电脑写完一段，拿起手机继续。</p>
      </div>
      <button
        v-if="status?.config?.spaceId"
        class="sync-button secondary"
        :disabled="pending"
        @click="connectPhone"
      >
        连接手机
      </button>
    </header>
    <button
      v-if="status?.config?.spaceId && tab === 'connection'"
      class="sync-button quiet sync-back-button"
      @click="tab = 'overview'"
    >
      <AppIcon name="arrow-left" />
      <span>返回同步首页</span>
    </button>
    <SyncConnectionForm
      v-if="!status?.config?.spaceId || tab === 'connection'"
      :config="status?.config ?? null"
      :pending="pending"
      :request="run"
      @done="tab = 'overview'"
    />
    <template v-else>
      <SyncStatusCard :status="status" :pending="pending" @request="run" />
      <nav class="sync-tabs" aria-label="同步页面">
        <button
          v-for="entry in tabs"
          :key="entry.id"
          :aria-current="tab === entry.id ? 'page' : undefined"
          @click="tab = entry.id"
        >
          {{ entry.label }}
        </button>
      </nav>
      <template v-if="tab === 'overview'">
        <SyncChangesPanel :status="status" />
        <SyncConflictCard
          v-for="issue in status.issues.filter(
            (entry) => entry.reason !== 'first-sync'
          )"
          :key="issue.token || issue.key"
          :issue="issue"
          :pending="pending"
          @resolve="
            (item) =>
              run({
                operation: 'sync',
                resolutions: [{ token: issue.token, item }]
              })
          "
        />
      </template>
      <section v-if="tab === 'content'" class="sync-card">
        <h2>同步内容</h2>
        <p>关闭只暂停本机同步，不删除任何内容。作品绑定的资料库也需要加入。</p>
        <label
          v-for="item in status.items"
          :key="item.key"
          class="sync-list-row"
          ><span
            >{{ item.title
            }}<small>{{
              !item.included
                ? "已暂停同步"
                : item.dirty && item.remoteDirty
                  ? "两端都有修改"
                  : item.dirty
                    ? "待上传到远端"
                    : item.remoteDirty
                      ? "待下载到本机"
                      : "已同步"
            }}</small></span
          ><input
            type="checkbox"
            :checked="item.included"
            :disabled="pending"
            :aria-label="`同步 ${item.title}`"
            @change="changeIncluded(item.key, $event)"
        /></label>
      </section>
      <section v-if="tab === 'devices'" class="sync-card">
        <h2>已连接的设备</h2>
        <p>
          来自上次同步检查，不代表当前在线状态。最后检查：{{
            status.lastCheckedAt
              ? new Date(status.lastCheckedAt).toLocaleString()
              : "尚未检查"
          }}
        </p>
        <div
          v-for="device in status.devices"
          :key="device.id"
          class="sync-list-row"
        >
          <strong
            >{{ device.name
            }}{{ device.id === status.deviceId ? "（本机）" : "" }}</strong
          ><span
            >{{
              device.receivedCurrent
                ? "已取回本机最新提交"
                : "尚未确认取回本机最新提交"
            }}<small>{{
              new Date(device.updatedAt).toLocaleString()
            }}</small></span
          >
        </div>
      </section>
      <section v-if="tab === 'history'" class="sync-card">
        <h2>历史与恢复</h2>
        <p>恢复只更新本机，下次手动同步时再上传。当前版本会继续保留。</p>
        <div
          v-for="entry in status.history"
          :key="entry.id"
          class="sync-list-row"
        >
          <span
            >{{ entry.title
            }}<small
              >{{ entry.description }} ·
              {{ new Date(entry.at).toLocaleString() }}</small
            ></span
          ><button
            class="sync-button secondary"
            :disabled="pending || !entry.canRestore"
            @click="restoring = entry"
          >
            恢复此版本
          </button>
        </div>
      </section>
    </template>
    <section v-if="qr" class="sync-card sync-pairing">
      <div>
        <h2>拿起手机，扫描接入码</h2>
        <p>
          手机「双端同步 →
          扫描电脑上的接入码」。核对账号后，填写网盘应用密码即可加入。
        </p>
        <p>二维码包含连接配置，不包含密码。</p>
        <button class="sync-button quiet" @click="qr = ''">收起接入码</button>
      </div>
      <img :src="qr" width="256" height="256" alt="手机端同步接入二维码" />
    </section>
    <div
      v-if="restoring"
      class="sync-modal-backdrop"
      @click.self="restoring = null"
    >
      <section
        class="sync-card"
        role="dialog"
        aria-modal="true"
        aria-label="恢复到本机"
      >
        <h2>恢复到本机</h2>
        <p>恢复“{{ restoring.title }}”的历史版本，当前版本会保留。</p>
        <div class="sync-tabs">
          <button class="sync-button secondary" @click="restoring = null">
            取消</button
          ><button class="sync-button" @click="restore">恢复</button>
        </div>
      </section>
    </div>
  </section>
</template>
