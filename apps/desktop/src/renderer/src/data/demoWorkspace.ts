import type { ChatMessage } from "../types/conversation";
import type { ResourceTreeSection, WorkspaceDocument } from "../types/workspace";

export const resourceSections: ResourceTreeSection[] = [
  {
    id: "creation",
    label: "创作空间",
    icon: "book",
    nodes: [
      {
        id: "book-mist-harbor",
        label: "雾港来信",
        icon: "book",
        defaultExpanded: true,
        children: [
          {
            id: "worldbuilding",
            label: "世界观",
            icon: "globe",
            defaultExpanded: false,
            children: [
              { id: "doc-harbor-geography", label: "雾港地理", icon: "file" },
              { id: "doc-gray-tide", label: "灰潮规则", icon: "file" }
            ]
          },
          {
            id: "characters",
            label: "人物",
            icon: "user",
            children: [
              { id: "doc-lin-mo", label: "林默", icon: "file" },
              { id: "doc-su-yao", label: "苏遥", icon: "file" }
            ]
          },
          {
            id: "plot",
            label: "剧情",
            icon: "sparkles",
            children: [{ id: "doc-main-outline", label: "主线大纲", icon: "file" }]
          },
          {
            id: "draft",
            label: "长篇正文",
            icon: "folder",
            defaultExpanded: true,
            children: [
              {
                id: "volume-one",
                label: "第一卷 · 潮声",
                icon: "folder",
                defaultExpanded: true,
                children: [
                  { id: "chapter-1", label: "第一章 灯塔来客", icon: "file" },
                  { id: "chapter-2", label: "第二章 失踪名单", icon: "file" },
                  { id: "chapter-3", label: "第三章 雨夜回声", icon: "file" }
                ]
              }
            ]
          },
          { id: "continuity-ledger", label: "状态账本", icon: "ledger" }
        ]
      }
    ]
  },
  {
    id: "skill",
    label: "技能库",
    icon: "library",
    nodes: [
      {
        id: "official-skills",
        label: "官方通用技能库",
        icon: "library",
        badge: "只读",
        children: [
          { id: "skill-continue", label: "自然续写", icon: "wand" },
          { id: "skill-polish", label: "文本润色", icon: "wand" },
          { id: "skill-structure", label: "结构诊断", icon: "wand" }
        ]
      },
      {
        id: "my-skills",
        label: "我的技能库",
        icon: "folder",
        children: [
          { id: "skill-suspense", label: "悬疑节奏增强", icon: "wand" },
          { id: "skill-dialogue", label: "人物对白校准", icon: "wand" }
        ]
      }
    ]
  },
  {
    id: "material",
    label: "素材库",
    icon: "archive",
    nodes: [
      {
        id: "mist-materials",
        label: "雾港素材库",
        icon: "archive",
        children: [
          { id: "material-fog", label: "海雾意象", icon: "file" },
          { id: "material-lighthouse", label: "灯塔考据", icon: "file" },
          { id: "material-night", label: "雨夜声音", icon: "file" }
        ]
      },
      {
        id: "writing-clips",
        label: "写作摘录",
        icon: "folder",
        children: [
          { id: "material-night-scene", label: "夜景描写", icon: "file" },
          { id: "material-dialogue", label: "对白片段", icon: "file" }
        ]
      }
    ]
  }
];

export const workspaceDocuments: WorkspaceDocument[] = [
  {
    id: "chapter-3",
    domain: "creation",
    title: "第三章 雨夜回声",
    eyebrow: "长篇正文",
    path: ["雾港来信", "第一卷 · 潮声", "第三章 雨夜回声"],
    format: "正文",
    content:
      "雨是在午夜以后落下来的。\n\n林默把灯塔最上层的窗推开一条缝，潮湿的风立刻钻进来，带着铁锈和海盐的气味。港区已经熄灯，只有旧码头尽头那盏信号灯仍在雾里明灭。\n\n第三次闪烁之后，他听见楼梯间传来脚步声。\n\n不是守塔人惯常拖沓的步子。那声音很轻，停在每一级台阶的边缘，像有人正沿着黑暗一层一层丈量这座塔。\n\n林默合上记录册，把那封没有署名的信压在掌心下面。窗外的汽笛迟到了整整七分钟，而信上写着：当第七声汽笛响起，不要回头。"
  },
  {
    id: "chapter-1",
    domain: "creation",
    title: "第一章 灯塔来客",
    eyebrow: "长篇正文",
    path: ["雾港来信", "第一卷 · 潮声", "第一章 灯塔来客"],
    format: "正文",
    content: "雾港的冬天从来没有真正的清晨。林默抵达灯塔时，海面仍是一片铅灰。"
  },
  {
    id: "chapter-2",
    domain: "creation",
    title: "第二章 失踪名单",
    eyebrow: "长篇正文",
    path: ["雾港来信", "第一卷 · 潮声", "第二章 失踪名单"],
    format: "正文",
    content: "名单上共有十七个名字。前十六个都被红笔划去，最后一行写着林默。"
  },
  {
    id: "doc-harbor-geography",
    domain: "creation",
    title: "雾港地理",
    eyebrow: "世界观",
    path: ["雾港来信", "世界观", "雾港地理"],
    format: "设定",
    content:
      "雾港建在北纬四十七度的狭长海湾内。城市分为旧港、坡城和北侧盐碱地三部分，唯一的陆路出口会在灰潮季被淹没。"
  },
  {
    id: "doc-gray-tide",
    domain: "creation",
    title: "灰潮规则",
    eyebrow: "世界观",
    path: ["雾港来信", "世界观", "灰潮规则"],
    format: "设定",
    content: "灰潮每隔十三年出现一次。潮汐期间，所有钟表每天会慢七分钟，海上的回声会先于声音抵达。"
  },
  {
    id: "doc-lin-mo",
    domain: "creation",
    title: "林默",
    eyebrow: "人物档案",
    path: ["雾港来信", "人物", "林默"],
    format: "设定",
    content: "29 岁，灯塔临时记录员。习惯把重要信息抄写两遍，对七年前姐姐的失踪保持沉默。"
  },
  {
    id: "doc-su-yao",
    domain: "creation",
    title: "苏遥",
    eyebrow: "人物档案",
    path: ["雾港来信", "人物", "苏遥"],
    format: "设定",
    content: "27 岁，地方报纸摄影记者。对港区旧建筑十分熟悉，随身携带一台无法正常显影的胶片相机。"
  },
  {
    id: "doc-main-outline",
    domain: "creation",
    title: "主线大纲",
    eyebrow: "剧情",
    path: ["雾港来信", "剧情", "主线大纲"],
    format: "设定",
    content: "第一幕：林默回到雾港接管灯塔记录工作。\n\n第二幕：失踪名单与延迟七分钟的城市时间逐渐重合。\n\n第三幕：灰潮抵达，灯塔真正的用途被揭开。"
  },
  {
    id: "continuity-ledger",
    domain: "creation",
    title: "状态账本",
    eyebrow: "已落盘事实",
    path: ["雾港来信", "状态账本"],
    format: "账本",
    readOnly: true,
    content: "• 林默已在第一章抵达雾港。\n• 苏遥知道旧港地下通道入口。\n• 第二章结尾，林默第一次看到失踪名单。"
  },
  {
    id: "skill-continue",
    domain: "skill",
    title: "自然续写",
    eyebrow: "官方通用技能库",
    path: ["官方通用技能库", "正文", "自然续写"],
    format: "技能",
    readOnly: true,
    content: "保持当前叙事视角、语体、节奏和人物认知边界，续写 800—1200 字。不得提前揭示大纲中尚未发生的事实。"
  },
  {
    id: "skill-polish",
    domain: "skill",
    title: "文本润色",
    eyebrow: "官方通用技能库",
    path: ["官方通用技能库", "正文", "文本润色"],
    format: "技能",
    readOnly: true,
    content: "在不改变情节事实与人物动机的前提下，压缩重复表达，增强动词准确度，并保持作者原有句式倾向。"
  },
  {
    id: "skill-structure",
    domain: "skill",
    title: "结构诊断",
    eyebrow: "官方通用技能库",
    path: ["官方通用技能库", "剧情", "结构诊断"],
    format: "技能",
    readOnly: true,
    content: "从目标、阻力、转折、代价四个维度诊断当前章节，只指出结构问题，不直接重写正文。"
  },
  {
    id: "skill-suspense",
    domain: "skill",
    title: "悬疑节奏增强",
    eyebrow: "我的技能库",
    path: ["我的技能库", "悬疑", "悬疑节奏增强"],
    format: "技能",
    content: "检查线索出现的间隔，确保每个新答案同时制造一个更具体的问题；避免连续两段使用相同强度的异常信号。"
  },
  {
    id: "skill-dialogue",
    domain: "skill",
    title: "人物对白校准",
    eyebrow: "我的技能库",
    path: ["我的技能库", "人物", "人物对白校准"],
    format: "技能",
    content: "根据人物档案校准措辞、句长、回避方式和潜台词。输出修改后的对白，并标注每处修改所依据的人物事实。"
  },
  {
    id: "material-fog",
    domain: "material",
    title: "海雾意象",
    eyebrow: "雾港素材库",
    path: ["雾港素材库", "意象", "海雾意象"],
    format: "素材",
    content: "雾吞没声音的边缘；玻璃上迟迟不落的水珠；远处灯光被拉成一条温吞的伤口。"
  },
  {
    id: "material-lighthouse",
    domain: "material",
    title: "灯塔考据",
    eyebrow: "雾港素材库",
    path: ["雾港素材库", "考据", "灯塔考据"],
    format: "素材",
    content: "传统菲涅尔透镜由同心环形棱镜构成，可以在减轻重量的同时汇聚光线。值守日志通常记录能见度、风向与灯器状态。"
  },
  {
    id: "material-night",
    domain: "material",
    title: "雨夜声音",
    eyebrow: "雾港素材库",
    path: ["雾港素材库", "声音", "雨夜声音"],
    format: "素材",
    content: "铁质排水管的空响、雨线扫过旧木窗的沙声、远洋船低沉而迟缓的汽笛。"
  },
  {
    id: "material-night-scene",
    domain: "material",
    title: "夜景描写",
    eyebrow: "写作摘录",
    path: ["写作摘录", "场景", "夜景描写"],
    format: "素材",
    content: "夜色不是落下来的，而是从街巷深处慢慢漫出来，先淹没台阶，再爬上每一扇紧闭的窗。"
  },
  {
    id: "material-dialogue",
    domain: "material",
    title: "对白片段",
    eyebrow: "写作摘录",
    path: ["写作摘录", "对白", "对白片段"],
    format: "素材",
    content: "“你听见了吗？”\n“听见什么？”\n“那声还没有响起的钟。”"
  }
];

export const initialMessages: ChatMessage[] = [
  {
    id: "assistant_welcome",
    role: "assistant",
    content: "创作空间已准备好。当前阶段会把发送瞬间的主文稿快照交给本地 Faux Runtime，用于验证 Thinking 与回复流；技能和素材尚不会自动附加。",
    createdAt: new Date().toISOString(),
    status: "completed"
  }
];

export function findWorkspaceDocument(id: string): WorkspaceDocument | undefined {
  return workspaceDocuments.find((document) => document.id === id);
}
