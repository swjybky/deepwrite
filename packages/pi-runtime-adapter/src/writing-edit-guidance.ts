export const WRITING_EDIT_CONTENT_GUIDANCE =
  "按修改范围选择参数：空白目标直接用 content 写入；用户明确要求对目标全文进行“内容重制”“整篇重写”或“重新生成”时，先用 read 完整读取目标，再在同一次 edit 调用中传入 content=重制后的完整正文、allow_overwrite_existing=true 和 summary。content 会替换目标全文，不能只传改动段落；content 传入空字符串表示清空目标正文，保留对象，清空非空正文同样需要完整读取和覆盖开关。局部润色、修订或部分段落重写使用 replacements，original_text 必须是完整读取后唯一匹配的原文，new_text 是该片段的新文本。";

export const WRITING_EDIT_OVERWRITE_DESCRIPTION =
  "仅与 content 配合：目标已有非空正文，且用户明确要求对该目标全文重制、重写、替换或清空时，必须显式传 true，并先用 read 完整读取目标。用户已经明确上述要求且目标范围清楚时，无需为此参数重复询问；仅要求局部修改时使用 replacements，不要整篇覆盖。目标为空或使用 replacements、meta 时省略。";

export const WRITING_EDIT_CONTENT_DESCRIPTION =
  '目标对象自身重制后的完整正式正文，不是局部补丁。content 会替换目标全文；content="" 表示清空目标正文，保留对象。对已有非空正文进行内容重制、整篇重写或清空时，先完整 read，再同时传入 allow_overwrite_existing=true；局部修改使用 replacements。不得混入标题、相邻章节、分析过程、操作说明或聊天回复。';

export const WRITING_EDIT_OVERWRITE_RECOVERY =
  "未修改：目标已有正文，整篇覆盖需设置 allow_overwrite_existing=true。未生成修改提案。若用户已明确要求对该目标全文进行内容重制、整篇重写或清空，请先确保已用 read 完整读取，再用完整 content、allow_overwrite_existing=true 和 summary 重新调用 edit，无需为覆盖参数重复询问。若只需局部修改，请改用 replacements；目标或重写范围不明确时先询问用户。";
