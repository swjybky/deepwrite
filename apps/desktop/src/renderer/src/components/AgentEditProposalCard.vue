<script setup lang="ts">
import { computed } from "vue";
import type { AgentEditProposal, ChatMessage } from "../types/conversation";
import { longImpactConfirmationLines } from "../utils/longImpactConfirmation";
import AppIcon from "./AppIcon.vue";
import ApprovalDiscardButton from "./ApprovalDiscardButton.vue";
import {
  approvalDiscardStatusLabel,
  approvalDiscardStatusMessage,
  approvalDiscardVisualStatus,
  shouldShowApprovalDiscardButton
} from "./approvalDiscardPresentation";

const props = withDefaults(
  defineProps<{
    proposal: AgentEditProposal;
    messageStatus: ChatMessage["status"];
    allowLiveEditReview?: boolean;
    discardable?: boolean;
  }>(),
  {
    allowLiveEditReview: false,
    discardable: false
  }
);

const emit = defineEmits<{
  review: [
    payload: {
      runId: string;
      proposalId: string;
      decision: "accept" | "reject";
    }
  ];
  locate: [payload: { runId: string; proposalId: string }];
  discard: [payload: { runId: string; proposalId: string }];
}>();

const proposalStatusLabels: Record<AgentEditProposal["status"], string> = {
  pending: "待审阅",
  accepting: "正在应用",
  accepted: "已接受",
  rejected: "已拒绝",
  conflict: "变更冲突",
  error: "应用失败"
};

const proposalStatusMessages: Record<AgentEditProposal["status"], string> = {
  pending: "接受后将应用到当前文稿并自动保存到本机。",
  accepting: "正在应用变更并保存……",
  accepted: "变更已应用并保存到本机。",
  rejected: "已保留当前文稿，未应用这次变更。",
  conflict: "变更无法应用，未覆盖当前内容。",
  error: "变更未能应用，请检查运行详情。"
};

function proposalStatusLabel(): string {
  const discardLabel = approvalDiscardStatusLabel(proposalDiscardState());
  if (discardLabel) return discardLabel;
  if (
    props.proposal.status === "pending" &&
    props.proposal.approvalMode === "auto-approve"
  ) {
    return "待自动保存";
  }
  if (isLongProposal()) {
    if (props.proposal.status === "accepting") return "正在保存";
    if (props.proposal.status === "conflict") return "内容已变化";
    if (props.proposal.status === "error") return "保存失败";
  }
  return proposalStatusLabels[props.proposal.status];
}

function proposalVisualStatus(): AgentEditProposal["status"] {
  return (
    approvalDiscardVisualStatus(proposalDiscardState()) ?? props.proposal.status
  );
}

function showDiscardButton(): boolean {
  return shouldShowApprovalDiscardButton(
    props.discardable,
    props.proposal.status === "accepted",
    proposalDiscardState()
  );
}

function proposalAcceptLabel(): string {
  if (props.proposal.status === "accepting") return "保存中…";
  if (isLongProposal()) {
    if (!longExpectedImpact.value) return "核对影响";
    return props.proposal.status === "error" ? "重新确认" : "确认并保存";
  }
  return props.proposal.status === "error" ? "重试接受并保存" : "接受并保存";
}

function isLongProposal(): boolean {
  return Boolean(
    props.proposal.longWorldbuildingTarget ||
    props.proposal.longCharacterTarget ||
    props.proposal.longPlotDesignTarget ||
    props.proposal.longDraftTarget
  );
}

function proposalDiscardState(): AgentEditProposal["discardState"] | undefined {
  return isLongProposal() ? undefined : props.proposal.discardState;
}

const longExpectedImpact = computed(
  () =>
    props.proposal.longWorldbuildingTarget?.expectedImpact ??
    props.proposal.longCharacterTarget?.expectedImpact ??
    props.proposal.longPlotDesignTarget?.expectedImpact ??
    props.proposal.longDraftTarget?.expectedImpact
);
const longExpectedImpactLines = computed(() =>
  longExpectedImpact.value
    ? longImpactConfirmationLines(longExpectedImpact.value)
    : []
);

function canReviewProposalWhileStreaming(): boolean {
  return props.allowLiveEditReview;
}

function showProposalReviewActions(): boolean {
  if (
    props.proposal.approvalMode === "auto-approve" &&
    canReviewProposalWhileStreaming() &&
    (props.proposal.status === "pending" ||
      props.proposal.status === "accepting")
  ) {
    return false;
  }
  return (
    props.proposal.status === "pending" ||
    props.proposal.status === "accepting" ||
    props.proposal.status === "error" ||
    props.proposal.status === "conflict"
  );
}

function isProposalReviewable(decision: "accept" | "reject"): boolean {
  return (
    props.proposal.status === "pending" ||
    props.proposal.status === "error" ||
    (decision === "reject" && props.proposal.status === "conflict")
  );
}

function proposalReviewDisabled(decision: "accept" | "reject"): boolean {
  if (!isProposalReviewable(decision)) return true;
  return (
    props.messageStatus === "streaming" && !canReviewProposalWhileStreaming()
  );
}

function proposalStatusMessage(): string {
  const proposal = props.proposal;
  const discardMessage = approvalDiscardStatusMessage(proposalDiscardState());
  if (discardMessage) return discardMessage;
  if (!proposal.statusMessage && isLongProposal()) {
    if (proposal.status === "accepting") {
      return "正在直接保存这项长篇修改……";
    }
    if (proposal.status === "conflict") {
      return "目标内容或关联关系已经变化，本次修改尚未保存。";
    }
    if (proposal.status === "error") {
      return "这项长篇修改未能保存，请检查运行详情。";
    }
  }
  if (
    props.messageStatus === "streaming" &&
    proposal.status === "pending" &&
    proposal.approvalMode === "auto-approve" &&
    canReviewProposalWhileStreaming()
  ) {
    return "本项已生成，正在进入实时自动保存队列；智能体仍在继续。";
  }
  if (
    props.messageStatus === "streaming" &&
    proposal.status === "pending" &&
    canReviewProposalWhileStreaming()
  ) {
    return "本项已生成，可立即审阅；智能体仍在继续。";
  }
  if (
    props.messageStatus === "streaming" &&
    proposal.status === "error" &&
    canReviewProposalWhileStreaming()
  ) {
    return (
      proposal.statusMessage ??
      "实时保存失败，可立即重试或拒绝；智能体仍在继续。"
    );
  }
  if (
    props.messageStatus === "streaming" &&
    proposal.status === "pending" &&
    proposal.approvalMode === "auto-approve"
  ) {
    return "本项已生成，已加入实时自动保存队列。";
  }
  if (
    props.messageStatus === "streaming" &&
    (proposal.status === "pending" || proposal.status === "error")
  ) {
    return "生成完成后可审阅。";
  }
  if (
    !proposal.statusMessage &&
    proposal.status === "pending" &&
    proposal.libraryTarget
  ) {
    return proposal.libraryTarget.operation === "create"
      ? "接受后将创建资料库条目并保存到本机。"
      : "接受后将更新资料库条目并保存到本机。";
  }
  if (
    !proposal.statusMessage &&
    proposal.status === "pending" &&
    proposal.draftSectionCreationTarget
  ) {
    return "接受后将批量创建空白正文与人物状态文件并保存到本机。";
  }
  if (
    !proposal.statusMessage &&
    proposal.status === "pending" &&
    proposal.draftSectionRenameTarget
  ) {
    return "接受后将修改章节名称并保存到本机；正文内容保持不变。";
  }
  if (
    !proposal.statusMessage &&
    proposal.status === "pending" &&
    proposal.draftSectionDeletionTarget
  ) {
    return "接受后将永久删除该章节及其正文与人物状态文件。";
  }
  if (
    !proposal.statusMessage &&
    proposal.status === "pending" &&
    proposal.longWorldbuildingTarget
  ) {
    return proposal.longWorldbuildingTarget.file.operation === "create"
      ? "接受后将创建一个空白世界观文件并保存到本机。"
      : "接受后将写入世界观文件并保存到本机。";
  }
  if (
    !proposal.statusMessage &&
    proposal.status === "pending" &&
    proposal.longCharacterTarget
  ) {
    return proposal.longCharacterTarget.files.every(
      ({ operation }) => operation === "create"
    )
      ? "接受后将创建人物及其两份档案并保存到本机。"
      : "接受后将写入人物档案并保存到本机。";
  }
  if (
    !proposal.statusMessage &&
    proposal.status === "pending" &&
    proposal.longPlotDesignTarget
  ) {
    return "接受后将校验结构影响并保存剧情设计。";
  }
  if (
    !proposal.statusMessage &&
    proposal.status === "pending" &&
    proposal.longDraftTarget
  ) {
    return "接受后将把当前章正文保存到该章节独立的 Markdown 文件。";
  }
  return (
    proposal.statusMessage?.trim() || proposalStatusMessages[proposal.status]
  );
}

function review(decision: "accept" | "reject"): void {
  if (proposalReviewDisabled(decision)) return;
  emit("review", {
    runId: props.proposal.runId,
    proposalId: props.proposal.id,
    decision
  });
}

function diffLineMark(type: "context" | "addition" | "deletion"): string {
  if (type === "addition") return "+";
  if (type === "deletion") return "−";
  return " ";
}
</script>

<template>
  <article
    class="edit-proposal-card"
    :class="`is-${proposalVisualStatus()}`"
    :aria-busy="
      proposal.status === 'accepting' ||
      proposalDiscardState()?.status === 'discarding'
    "
  >
    <header class="edit-proposal-header">
      <span class="edit-proposal-icon" aria-hidden="true">
        <AppIcon name="file" :size="17" />
      </span>
      <div class="edit-proposal-heading">
        <div class="edit-proposal-title-row">
          <strong>{{ proposal.title }}</strong>
          <span
            class="edit-proposal-status"
            :class="`is-${proposalVisualStatus()}`"
          >
            {{ proposalStatusLabel() }}
          </span>
          <button
            v-if="proposal.status === 'accepted'"
            class="approval-target-button"
            type="button"
            title="跳转到目标文件"
            aria-label="跳转到目标文件"
            @click.stop="
              emit('locate', {
                runId: proposal.runId,
                proposalId: proposal.id
              })
            "
          >
            跳转到目标文件
          </button>
          <ApprovalDiscardButton
            v-if="showDiscardButton()"
            :discarding="proposalDiscardState()?.status === 'discarding'"
            @discard="
              emit('discard', {
                runId: proposal.runId,
                proposalId: proposal.id
              })
            "
          />
        </div>
        <p>{{ proposal.summary }}</p>
      </div>
      <div
        class="edit-proposal-stats"
        :aria-label="`增加 ${proposal.additions} 行，删除 ${proposal.deletions} 行`"
      >
        <span class="is-addition">+{{ proposal.additions }}</span>
        <span class="is-deletion">−{{ proposal.deletions }}</span>
      </div>
    </header>

    <details v-if="proposal.hunks.length" class="edit-proposal-diff">
      <summary>
        <span>查看差异</span>
        <small>{{ proposal.hunks.length }} 个变更块</small>
        <AppIcon name="chevron" :size="13" />
      </summary>
      <div class="edit-diff-content">
        <div
          v-for="(hunk, hunkIndex) in proposal.hunks"
          :key="`${proposal.id}-hunk-${hunkIndex}`"
          class="edit-diff-hunk"
        >
          <div class="edit-diff-hunk-header">
            @@ -{{ hunk.oldStart }},{{ hunk.oldLines }} +{{ hunk.newStart }},{{
              hunk.newLines
            }}
            @@
          </div>
          <div
            v-for="(line, lineIndex) in hunk.lines"
            :key="`${proposal.id}-${hunkIndex}-${lineIndex}`"
            class="edit-diff-line"
            :class="`is-${line.type}`"
          >
            <span class="edit-diff-line-number">{{
              line.oldLineNumber ?? ""
            }}</span>
            <span class="edit-diff-line-number">{{
              line.newLineNumber ?? ""
            }}</span>
            <span class="edit-diff-line-mark" aria-hidden="true">
              {{ diffLineMark(line.type) }}
            </span>
            <code>{{ line.text }}</code>
          </div>
        </div>
        <p v-if="proposal.truncated" class="edit-diff-truncated">
          差异较大，仅显示部分变更；行数统计包含完整提案。
        </p>
      </div>
    </details>
    <p v-else class="edit-proposal-empty">没有可显示的行级差异。</p>

    <section
      v-if="longExpectedImpact"
      class="long-proposal-impact"
      aria-label="本次长篇修改的精确影响"
    >
      <strong>本次结构与关联影响</strong>
      <ul v-if="longExpectedImpactLines.length">
        <li v-for="line in longExpectedImpactLines" :key="line">
          {{ line }}
        </li>
      </ul>
      <p v-else>没有额外关联变化，仅保存提案中的文件内容。</p>
    </section>

    <footer class="edit-proposal-footer">
      <span class="edit-proposal-message">{{ proposalStatusMessage() }}</span>
      <div v-if="showProposalReviewActions()" class="edit-proposal-actions">
        <button
          class="edit-review-button is-reject"
          type="button"
          :disabled="proposalReviewDisabled('reject')"
          @click="review('reject')"
        >
          拒绝
        </button>
        <button
          v-if="proposal.status !== 'conflict'"
          class="edit-review-button is-accept"
          type="button"
          :disabled="proposalReviewDisabled('accept')"
          @click="review('accept')"
        >
          {{ proposalAcceptLabel() }}
        </button>
      </div>
    </footer>
  </article>
</template>

<style scoped>
.long-proposal-impact {
  display: grid;
  gap: 6px;
  margin: 10px 14px 0;
  padding: 10px 12px;
  border: 1px solid var(--theme-line-soft);
  border-radius: 8px;
  background: var(--surface-muted);
  color: var(--text-secondary);
  font-size: 0.785714rem;
  line-height: 1.5;
}

.long-proposal-impact strong {
  color: var(--text-primary);
}

.long-proposal-impact ul {
  display: grid;
  gap: 4px;
  margin: 0;
  padding-left: 18px;
}

.long-proposal-impact p {
  margin: 0;
}
</style>
