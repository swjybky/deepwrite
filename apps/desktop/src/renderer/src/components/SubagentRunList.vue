<script setup lang="ts">
import { computed } from "vue";
import type { ChatMessage } from "../types/conversation";
import { writeToolText } from "../utils/agentWriteToolPreview";
import {
  formatToolPayload,
  isWriteTool,
  toolDetail,
  toolGroupIsRunning,
  toolGroupLabel,
  toolIcon,
  toolLabel,
  visibleToolArguments,
  writeToolContentLabel,
  writeToolTarget
} from "./conversationToolPresentation";
import {
  subagentDuration,
  subagentProcessingDisplayItems,
  subagentRetryProgress,
  subagentRetryStatus,
  subagentReviewHint,
  subagentStatusLabel,
  subagentUsageLabel
} from "./subagentRunPresentation";
import AppIcon from "./AppIcon.vue";
import StreamedContent from "./StreamedContent.vue";

const props = defineProps<{
  message: ChatMessage;
  now: number;
}>();

const runs = computed(() => props.message.subagentRuns ?? []);
</script>

<template>
  <section
    v-if="runs.length"
    class="subagent-run-list"
    aria-label="子智能体执行记录"
  >
    <details
      v-for="run in runs"
      :key="run.parentToolCallId"
      class="subagent-run-card"
      :class="`is-${run.status}`"
      :aria-busy="run.status === 'running'"
    >
      <summary>
        <span class="subagent-run-icon" aria-hidden="true">
          <AppIcon name="user" :size="17" />
        </span>
        <span class="subagent-run-heading">
          <span class="subagent-run-title-row">
            <strong>{{ run.name }}</strong>
            <span class="subagent-run-status" :class="`is-${run.status}`">
              {{ subagentStatusLabel(run, now) }}
            </span>
          </span>
          <span class="subagent-run-task">{{ run.task }}</span>
        </span>
        <span class="subagent-run-meta" aria-label="子任务运行摘要">
          <span v-if="subagentDuration(run, now)">{{
            subagentDuration(run, now)
          }}</span>
          <span v-if="subagentRetryProgress(run)">{{
            subagentRetryProgress(run)
          }}</span>
          <span>{{ run.toolCalls.length }} 个工具</span>
          <span v-if="subagentReviewHint(message, run)" class="is-review">
            {{ subagentReviewHint(message, run) }}
          </span>
        </span>
        <AppIcon class="subagent-run-chevron" name="chevron" :size="14" />
      </summary>

      <div class="subagent-run-detail">
        <section class="subagent-run-handoff subagent-run-assigned-task">
          <strong>主智能体下发的任务</strong>
          <p>{{ run.task }}</p>
        </section>
        <div v-if="subagentRetryStatus(run, now)" class="subagent-run-waiting">
          {{ subagentRetryStatus(run, now) }}
        </div>
        <div
          v-if="subagentProcessingDisplayItems(run).length"
          class="subagent-processing-list"
          aria-label="子智能体执行过程"
        >
          <template
            v-for="item in subagentProcessingDisplayItems(run)"
            :key="item.id"
          >
            <details
              v-if="item.type === 'thinking'"
              class="processing-live-item processing-live-thinking"
            >
              <summary>
                <span>{{
                  run.status === "running" ? "思考中" : "思考过程"
                }}</span>
                <AppIcon name="chevron" :size="13" />
              </summary>
              <div class="processing-live-body processing-thinking">
                <StreamedContent
                  :content="item.content"
                  format="plain"
                  :streaming="run.status === 'running'"
                />
              </div>
            </details>
            <div
              v-else-if="item.type === 'response'"
              class="processing-step processing-response subagent-processing-response"
            >
              <StreamedContent
                :content="item.content"
                format="markdown"
                :streaming="run.status === 'running'"
              />
            </div>
            <details
              v-else-if="item.type === 'tool'"
              class="processing-live-item processing-live-tool"
            >
              <summary>
                <div
                  class="tool-trace"
                  :class="[
                    `is-${item.tool.status}`,
                    { 'is-write': isWriteTool(item.tool) }
                  ]"
                >
                  <AppIcon
                    v-if="!isWriteTool(item.tool)"
                    :name="toolIcon(item.tool)"
                    :size="17"
                  />
                  <div>
                    <div v-if="isWriteTool(item.tool)" class="write-tool-label">
                      <strong>{{ toolLabel(item.tool) }}</strong>
                      <AppIcon name="chevron" :size="13" />
                    </div>
                    <strong v-else>{{ toolLabel(item.tool) }}</strong>
                    <span v-if="toolDetail(item.tool)">{{
                      toolDetail(item.tool)
                    }}</span>
                  </div>
                </div>
                <AppIcon
                  v-if="!isWriteTool(item.tool)"
                  name="chevron"
                  :size="13"
                />
              </summary>
              <div class="processing-live-body tool-detail">
                <div v-if="isWriteTool(item.tool)" class="write-tool-detail">
                  <div class="write-tool-output-heading">
                    <span>{{ writeToolContentLabel(item.tool) }}</span>
                    <small v-if="writeToolTarget(item.tool)">
                      {{ writeToolTarget(item.tool) }}
                    </small>
                    <small>
                      {{
                        writeToolText(item.tool).length.toLocaleString("zh-CN")
                      }}
                      字符
                    </small>
                  </div>
                  <pre
                    class="write-tool-output"
                    :class="{
                      'is-streaming': item.tool.status === 'preparing'
                    }"
                    >{{
                      writeToolText(item.tool) || "正在等待写入内容……"
                    }}</pre>
                </div>
                <div
                  v-else-if="formatToolPayload(visibleToolArguments(item.tool))"
                >
                  <span>调用参数</span>
                  <pre>{{
                    formatToolPayload(visibleToolArguments(item.tool))
                  }}</pre>
                </div>
                <div v-if="item.tool.resultSummary">
                  <span>执行结果</span>
                  <p>{{ item.tool.resultSummary }}</p>
                </div>
              </div>
            </details>
            <details
              v-else
              class="processing-live-item processing-live-thinking processing-tool-group"
              :aria-busy="toolGroupIsRunning(item.tools)"
            >
              <summary>
                <span>{{ toolGroupLabel(item.tools) }}</span>
                <AppIcon name="chevron" :size="13" />
              </summary>
              <div
                class="processing-live-body tool-call-list"
                aria-label="工具调用列表"
              >
                <details
                  v-for="tool in item.tools"
                  :key="tool.id"
                  class="processing-live-item processing-live-tool tool-call-list-item"
                >
                  <summary>
                    <div class="tool-trace" :class="`is-${tool.status}`">
                      <AppIcon :name="toolIcon(tool)" :size="17" />
                      <div>
                        <strong>{{ toolLabel(tool) }}</strong>
                        <span v-if="toolDetail(tool)">{{
                          toolDetail(tool)
                        }}</span>
                      </div>
                    </div>
                    <AppIcon name="chevron" :size="13" />
                  </summary>
                  <div class="processing-live-body tool-detail">
                    <div v-if="formatToolPayload(visibleToolArguments(tool))">
                      <span>调用参数</span>
                      <pre>{{
                        formatToolPayload(visibleToolArguments(tool))
                      }}</pre>
                    </div>
                    <div v-if="tool.resultSummary">
                      <span>执行结果</span>
                      <p>{{ tool.resultSummary }}</p>
                    </div>
                  </div>
                </details>
              </div>
            </details>
          </template>
        </div>
        <div v-else-if="run.status === 'running'" class="subagent-run-waiting">
          正在启动独立上下文并接收执行事件…
        </div>

        <section
          v-if="run.summary || run.errorMessage"
          class="subagent-run-handoff"
          :class="{ 'is-error': run.status === 'error' }"
        >
          <strong>{{
            run.status === "completed" ? "交接摘要" : "结束说明"
          }}</strong>
          <StreamedContent
            v-if="run.summary"
            :content="run.summary"
            format="markdown"
          />
          <p
            v-if="run.errorMessage && !run.summary?.includes(run.errorMessage)"
          >
            {{ run.errorMessage }}
          </p>
          <small v-if="subagentUsageLabel(run)">{{
            subagentUsageLabel(run)
          }}</small>
        </section>
      </div>
    </details>
  </section>
</template>
