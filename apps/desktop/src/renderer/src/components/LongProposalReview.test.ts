import { describe, expect, it } from "vitest";
import conversationItemSource from "./ConversationMessageItem.vue?raw";
import processingItemSource from "./ConversationProcessingItem.vue?raw";
import editProposalSource from "./AgentEditProposalCard.vue?raw";
import editDiffSource from "./AgentEditProposalDiff.vue?raw";
import ledgerFinalizationSource from "./LongLedgerFinalizationCard.vue?raw";
import impactDetailsSource from "./LongProposalImpactDetails.vue?raw";
import source from "./LongProposalReview.vue?raw";

const conversationSource = `${conversationItemSource}\n${processingItemSource}`;

describe("LongProposalReview content file cards", () => {
  it("offers target navigation after a proposal is accepted", () => {
    expect(source).toContain("locate: [eventId: string]");
    expect(source).toContain("v-if=\"item.status === 'accepted'\"");
    expect(source).toContain("approval-target-button");
    expect(source).toContain("跳转到目标文件");
    expect(source).toContain("emit('locate', item.event.id)");
    expect(conversationSource).toContain(
      "@locate=\"emit('locateLongProposal', $event)\""
    );
    expect(
      conversationSource.match(
        /@locate="emit\('locateLongProposal', \$event\)"/g
      )
    ).toHaveLength(2);
  });

  it("does not expose rollback or discard actions for accepted long proposals", () => {
    expect(source).not.toContain("discardableEventIds");
    expect(source).not.toContain("showDiscardButton");
    expect(source).not.toContain("<ApprovalDiscardButton");
    expect(source).not.toContain("emit('discard'");
  });

  it("supports inline rendering inside its originating conversation turn", () => {
    expect(source).toContain("embedded?: boolean");
    expect(source).toContain("'is-embedded': embedded");
    expect(source).toContain(
      "'has-edit-proposal-surface-items': hasEditProposalSurfaceItems"
    );
    expect(source).toContain('<header v-if="!embedded">');
    expect(source).toContain(".long-proposal-review.is-embedded");
  });

  it("uses the existing text-edit card surface for every Markdown proposal", () => {
    expect(source).toContain("long.worldbuilding_file_proposal");
    expect(source).toContain("long.character_file_proposal");
    expect(source).toContain("buildAgentTextDiff");
    for (const className of [
      "edit-proposal-card",
      "edit-proposal-header",
      "edit-proposal-status",
      "edit-proposal-stats",
      "edit-proposal-diff",
      "edit-diff-content",
      "edit-proposal-footer",
      "edit-proposal-actions",
      "edit-review-button is-reject",
      "edit-review-button is-accept"
    ]) {
      expect(source).toContain(className);
      expect(
        `${conversationSource}\n${editProposalSource}\n${editDiffSource}`
      ).toContain(className);
    }
    expect(source).not.toContain("worldbuilding-file-card");
    expect(source).not.toContain("查看提交内容");
    expect(source).toContain("contentProposalDiffStats(item)");
    expect(source).toContain("已自动批准并保存到本地 Markdown。");
    expect(source).toContain("接受后将应用到对应 Markdown 并自动保存到本机。");
    expect(source).not.toContain("重试接受并保存");
    expect(source).toContain("等待前序文件");
    expect(source).toContain("正在等待前序文件创建或写入完成，随后继续校验。");
  });

  it("renders ledger finalization as a durable status card with retry", () => {
    expect(source).toContain("LongLedgerFinalizationCard");
    expect(source).toContain("long.ledger_commit_proposal");
    expect(ledgerFinalizationSource).toContain("连续性账本归档");
    expect(ledgerFinalizationSource).toContain("归档失败");
    expect(ledgerFinalizationSource).toContain("重试归档");
    expect(ledgerFinalizationSource).toContain("关闭并保留文件");
    expect(ledgerFinalizationSource).toContain(
      'v-if="item.errorRetryable !== false"'
    );
    expect(ledgerFinalizationSource).toContain("item.error");
  });

  it("keeps structure changes separate from worldbuilding file writes", () => {
    expect(source).toContain('case "long.mutation_proposal":');
    expect(source).toContain('return "结构变更";');
    expect(source).toContain('case "long.worldbuilding_file_proposal":');
    expect(source).toContain('case "long.character_file_proposal":');
    expect(source).toContain('return "确认写入并保存";');
  });

  it("uses the same approval-card surface for structure proposals", () => {
    expect(source).toContain("function isStructureProposalItem");
    expect(source).toContain("function usesEditProposalSurface");
    expect(source).toContain("function structureProposalStatusMessage");
    expect(source).toContain("function structureProposalAcceptLabel");
    expect(source).toContain(
      "usesEditProposalSurface(item)\n              ? ['edit-proposal-card'"
    );
    expect(source).toContain("结构变更已应用并保存到本机。");
  });

  it("shows exact relationship and ledger effects before approval", () => {
    expect(source).toContain("<LongProposalImpactDetails");
    expect(impactDetailsSource).toContain("preview.relationshipChanges.length");
    expect(impactDetailsSource).toContain("关联关系变化");
    expect(impactDetailsSource).toContain(
      "relationshipActionLabel(change.action)"
    );
    expect(impactDetailsSource).toContain(
      "relationshipKindLabels[change.kind]"
    );
    expect(impactDetailsSource).toContain("preview.ledgerRecordEdits.length");
    expect(impactDetailsSource).toContain("连续性账本记录影响");
    expect(impactDetailsSource).toContain("edit.commitId");
    expect(impactDetailsSource).toContain("edit.recordFile.id");
    expect(impactDetailsSource).toContain("ledgerRecordEditCount(edit)");
    expect(impactDetailsSource).toContain('"character-type": "人物类型"');
  });

  it("does not present deterministic preview failures as retryable apply failures", () => {
    expect(source).toContain('item.errorPhase === "preview"');
    expect(source).toContain("校验未通过");
    expect(source).toContain("尚未应用");
    expect(source).toContain("item.errorRetryable === false");
    expect(source).not.toContain("需重新生成提案");
  });

  it("does not render unverified continuity metadata or diffs", () => {
    expect(source).toContain("trustedContinuityIdentity");
    expect(source).toContain("contentFileTitle(item, card.file)");
    expect(source).toContain("canDisplayContentFileDiff(item)");
    expect(source).toContain('item.status === "ready"');
    expect(source).toContain('item.status === "submitting"');
    expect(source).toContain('item.status === "accepted"');
    expect(source).toContain("文件身份和原文尚未通过校验");
    expect(source).not.toContain("{{ card.file.filePath }}");
  });
});
