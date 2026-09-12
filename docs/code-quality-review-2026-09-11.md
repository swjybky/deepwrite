# DeepWrite 代码质量审查与提升报告

审查日期：2026-09-11。对象：`/Users/wenjia/project/deepwrite` 当前工作区，包含未提交和未跟踪代码；基准提交 `b0f5bb2feb7b2ec12b8916475da23d4a1280d6d1`。

后续处置：F2 的模型配置错配问题已改为 V3 单文件原子提交，并增加故障与迁移回归测试。详见 [存储设计](./model-configuration-storage.md)。下文保留首次审查的历史发现与统计，原始行号对应当时工作区。

## 结论

**项目已有扎实的工程基础，但变更安全性尚未匹配当前代码规模。应优先修复数据一致性缺陷，再完成真正的职责拆分，并让测试和检查覆盖实际运行路径。**

架构方向值得保留：Electron 进程分工、Zod 契约、Main 授权、Core 写入、严格 TypeScript、统一校验入口都已落地；文稿事务、冲突、恢复和智能体事件也已有大量行为测试。当前没有证据支持全盘重写。

本次在全套校验通过后，仍通过隔离故障注入复现了两项具体问题：短篇正文在特定外部并发写入时被静默覆盖；模型配置保存中断后可能形成旧地址与新密钥的错误组合。它们说明下一阶段最有价值的投入是验证数据不变量和失败路径。

本报告列出 **2 项 P1 缺陷、7 项 P2 改进项**。P1 表示应优先安排修复的数据或凭据一致性问题；P2 包括结构债务、保障缺口和容量预警，不表示都已造成线上故障。没有用主观权重生成百分制评分。

## 第一性原理：质量应保证什么

对于本地写作软件，质量首先取决于以下五个结果：

1. **用户作品不能无声丢失。** 保存、同步、退出、崩溃和重试后，应能解释最终版本，恢复必要的历史，并明确呈现冲突。
2. **权限与凭据不能错配。** Renderer 的请求必须经过校验和授权；模型地址、身份与密钥必须属于同一配置版本。
3. **改动影响应局限在明确职责内。** 修改一种提案或一种存储操作，不应依赖理解数千行闭包中的共享可变状态。
4. **测试必须有能力证伪错误行为。** 测试通过的价值来自它确实执行了产品路径，并在不变量被破坏时失败。
5. **交付应可重复、可诊断。** CI、桌面运行、平台差异和性能预算需要对应证据。

文件行数、测试数量和框架选型只是线索，不能单独证明上述结果。

## 范围、方法与证据

本次完成全仓文件普查、静态导入关系分析、关键链路人工抽查、完整工程校验、Electron 冒烟，以及隔离故障注入。重点阅读保存与恢复、模型配置、IPC 与 Utility 授权、同步服务、提案协调器和测试配置；没有逐行审阅全部文件。

统计范围为 `rg --files apps packages tools` 返回的 `.ts/.js/.mjs/.vue` 文件；包括声明与工程脚本，排除 Git 忽略的产物。测试及支持文件按 `.test.`、`.spec.`、`test-support`、`/fixtures/` 区分。行数含空行与注释，**不是有效逻辑行数，也不含独立 CSS 文件**。

- 非测试代码类文件：959 个，252,448 行。
- 测试及支持文件：538 个，116,918 行；这与 Vitest 实际收集的测试文件数口径不同。
- 普通实现类文件超过 400 行：94 个；Vue 文件超过 500 行：21 个。
- 测试及支持文件超过 600 行：40 个。
- 最大的 10 个非测试文件合计 35,198 行，占同口径总行数约 13.9%。

执行结果：

- `pnpm verify`：通过；格式、五组类型检查、ESLint、Renderer 边界、测试和构建均完成。
- Vitest：522 个文件、2,957 个测试通过；测试阶段墙钟时间 56.15 秒。这不是覆盖率。
- `pnpm smoke`：通过；验证了三个 Utility 的健康状态和 Pi/Faux 思考与文本流完成。未连接真实模型服务。
- `node tools/check-source-line-budget.mjs`：失败，8 项超限；此脚本不属于当前 `verify`。
- 两项隔离故障注入：均成功复现目标缺陷。实验断言的是现有错误行为，测试“通过”表示复现成功。
- 边界规则探针：包含两种违规导入形式的隔离样例仍被当前检查器放行。

统计开始与实验结束之间，对已盘点文件逐一核对 SHA-256，未发现变化。临时实验文件已移出仓库；生成本报告前 Git 状态与审查开始一致。未修改业务代码或提交 Git。

证据： [完整校验日志](/Users/wenjia/.codex/visualizations/2026/09/11/01a0906e-bc10-7200-86e7-d1f580052454/deepwrite-quality-evidence/verify.log)、[故障复现日志](/Users/wenjia/.codex/visualizations/2026/09/11/01a0906e-bc10-7200-86e7-d1f580052454/deepwrite-quality-evidence/atomicity.log)、[体量检查](/Users/wenjia/.codex/visualizations/2026/09/11/01a0906e-bc10-7200-86e7-d1f580052454/deepwrite-quality-evidence/line-budget.log)、[静态分析结果](/Users/wenjia/.codex/visualizations/2026/09/11/01a0906e-bc10-7200-86e7-d1f580052454/deepwrite-quality-evidence/structure.json)。

## 应当保留和扩大使用的实践

- 严格类型配置包含 `strict`、`noUncheckedIndexedAccess` 和 `exactOptionalPropertyTypes`；依赖大部分由 workspace catalog 固定，CI 使用冻结 lockfile。见 [类型配置](/Users/wenjia/project/deepwrite/tsconfig.base.json:7)、[CI](/Users/wenjia/project/deepwrite/.github/workflows/verify.yml:35)。
- 内部 Agent → Core 查询授权会校验 Main 已接受的运行、会话、资源、父请求和作用域，而非直接信任 Agent 提供的上下文。见 [授权器](/Users/wenjia/project/deepwrite/apps/desktop/src/main/internal-command-authorizer.ts:57)。
- 项目事务实现已有锁、预期哈希、暂存、日志、备份和恢复；文件写入有同步落盘操作。这是可以复用的资产。见 [事务提交](/Users/wenjia/project/deepwrite/apps/desktop/src/utilities/project-transaction/commit.ts:30)、[事务 I/O](/Users/wenjia/project/deepwrite/apps/desktop/src/utilities/project-transaction/io.ts:12)。
- 自动保存调度器通过注入计时器和持久化接口隔离职责，并处理重试、脏草稿、并发队列；比直接把这些逻辑嵌入组件更容易验证。见 [自动保存协调器](/Users/wenjia/project/deepwrite/apps/desktop/src/renderer/src/composables/useEditorAutoSaveCoordinator.ts:21)。
- 构建已检查可用态 JavaScript 总量，部分大功能按需加载。应保留预算，而不是为了通过构建抬高上限。

## 发现与改进建议

### F1 · P1 · 普通文稿保存存在外部更新丢失窗口

**性质：已复现的条件性数据丢失缺陷。**

`saveDocument` 先读取正文并核对 `baseRevision`，稍后直接替换目标文件；替换后再读文件，只能检查写入之后是否又发生了修改。外部编辑器在前一次读取与本次替换之间保存的新内容，会被覆盖，随后检查读到 DeepWrite 刚写入的内容，因此仍报告成功。

实验使用临时短篇项目，在 `rename` 替换正文之前注入一次独立写入；调用携带正常的基础版本，没有开启 `force`。最终保存成功，外部新正文被本地编辑覆盖。未触碰用户作品。

依据： [基础版本校验](/Users/wenjia/project/deepwrite/apps/desktop/src/utilities/folder-catalog-store.ts:2397)、[替换后检查](/Users/wenjia/project/deepwrite/apps/desktop/src/utilities/folder-catalog-store.ts:7125)。同一普通保存路径依次写 Markdown 与清单，通过 `catch` 回滚，没有该操作的持久事务日志；进程在两次写入之间退出时不会执行回滚。崩溃窗口为静态确认，本次未做断电实验。

**建议：** 将普通正文、标题和清单修改收口到可恢复的项目事务，并明确外部编辑的并发协议。自有写入者必须共用锁和版本条件；保留可恢复版本，不能仅靠写后相等判断避免覆盖。普通文件系统的检查加 `rename` 不是面向任意外部写入者的原子内容 CAS，单纯再加一次哈希检查仍会留下窗口，不能据此承诺绝对安全。

**验收：** 为读后写入、替换前写入、替换后写入以及提交各阶段进程退出建立故障矩阵；对自有并发写入强制版本冲突，对外部并发明确记录保障边界，确保被替换内容有恢复路径。恢复后正文与清单必须对应同一已提交状态。

### F2 · P1 · 模型元数据与密钥不能作为同一版本提交

**性质：已复现的配置与凭据一致性缺陷。**

修改自定义模型时，先提交 `model-secrets.json`，再提交 `models.json`。如果第二次提交失败，旧地址仍在，密钥已经更新。重新实例化配置仓库并调用 `resolve`，仍能读到“旧地址 + 新密钥”。单个文件的原子替换并不能保证两文件原子性。

实验使用 `old.example.test`、`new.example.test` 和明显无效的占位密钥，模拟第二个文件 `rename` 返回 `EIO`；保存被拒绝，但重载后的组合仍然错误。真实场景若继续调用该模型，新密钥可能随请求发送至旧服务地址；本次没有发送网络请求，也没有证明实际泄露已发生。

依据： [双文件提交顺序](/Users/wenjia/project/deepwrite/apps/desktop/src/main/model-config-store.ts:448)、[分别读取两文件](/Users/wenjia/project/deepwrite/apps/desktop/src/main/model-config-store.ts:609)。

**建议：** 使用一个包含加密密钥和模型元数据的原子配置文档，或者两个带同一 generation 的文件加单一提交指针；读取时拒绝混合版本。迁移和恢复均留在 Main，继续只向 Renderer 投影公开配置。

**验收：** 在每次文件写入与替换前后注入故障，重启后只能读到完整旧配置或完整新配置；更换地址、更换密钥、删除模型、清除密钥四类操作均覆盖。不得出现地址与密钥的跨版本组合。

### F3 · P2 · 部分职责拆分留下了未接入的实现副本

**性质：已确认的结构事实，会削弱测试可信度。**

`createApplyReview` 和 `createDraftSectionLane` 只发现定义，没有产品代码调用；实际协调器仍保留对应处理逻辑。前者文件 1,478 行、后者工厂作用域 917 行，维护者可能修改未执行的副本。`App.draft-section-agent.test.ts` 又把这些副本与真实协调器的源码拼接后做字符串断言，使任意副本保留目标文本即可通过部分检查。

依据： [未接入工厂 A](/Users/wenjia/project/deepwrite/apps/desktop/src/renderer/src/composables/proposal-coordinator/apply-review.ts:25)、[未接入工厂 B](/Users/wenjia/project/deepwrite/apps/desktop/src/renderer/src/composables/proposal-coordinator/draft-section-lane.ts:22)、[实际协调器](/Users/wenjia/project/deepwrite/apps/desktop/src/renderer/src/composables/useProposalCoordinator.ts:3472)、[源码拼接测试](/Users/wenjia/project/deepwrite/apps/desktop/src/renderer/src/App.draft-section-agent.test.ts:32)。

**建议：** 先确定唯一生效实现。完成一个职责的真实委托、切换行为测试后删除旧副本；没有迁移价值的死代码直接删除。不要继续复制代码来制造文件拆分。

**验收：** 每项行为有唯一产品入口；修改该实现能改变入口级测试结果；静态入口可达性检查不再留下这两套孤立工厂，删除副本不会损失产品行为覆盖。

### F4 · P2 · 关键模块体量与工程约束已经脱节

**性质：维护成本与规则执行缺口。**

风险集中在状态和写入中心：目录存储 7,319 行、提案协调器 4,276 行、长篇编辑组件 3,703 行、Main 入口 3,411 行、会话协调器 3,093 行、工作台壳 2,799 行。

AST 进一步确认 `registerIpc` 作用域约 1,980 行，`stageAgentEditProposal` 约 960 行；这些不只是文件中堆积静态声明。工厂和 composable 的作用域长度包含内部函数，不能等同于执行路径复杂度。

现有体量脚本尚未接入 `verify`，且新模块与测试预算均为 1,500 行，与 `AGENTS.md` 的 400/500/600 行约束不同；即便按脚本自身更宽的预算，也有 8 项失败，其中独立 CSS 另有 6,001 行。

依据： [实际 IPC 职责范围](/Users/wenjia/project/deepwrite/apps/desktop/src/main/index.ts:1161)、[体量脚本预算](/Users/wenjia/project/deepwrite/tools/check-source-line-budget.mjs:97)、[verify 入口](/Users/wenjia/project/deepwrite/package.json:26)。

**建议：** 在保留现有分层的前提下，Main 按命令域委托；目录仓库按作品生命周期、正文写入、资料库操作与投影读取分离；提案处理分离验证、持久化和 UI 状态转换。子模块只接受完成该职责所需的窄接口。把体量与可达性检查接入统一校验，并明确旧文件治理计划；新改动遵守现有约束，不扩大豁免。

**验收：** 新实现符合仓库体量限制，无新增豁免和循环依赖；每次拆分实际减少入口职责和跨模块共享可变状态，不能只把原来的宽 context 传遍所有文件。

### F5 · P2 · 存在三组静态运行时循环依赖

**性质：结构事实；本次未观察到它们导致启动失败。**

排除 `import type` 等纯类型边后，发现：

- `event-mapping.ts ↔ subagent-events.ts`。
- `folder-catalog-store/manifest.ts ↔ migrations.ts`。
- `agent-conversation/streaming.ts ↔ retry-subagent.ts`。

分析覆盖静态值导入与导出、相对路径和 `@deepwrite/*`，没有把动态导入图当成完整证明。循环本身不必然在当前 ESM 执行中出错，但会让初始化、独立测试和后续重构更加互相依赖，也违反仓库已有约束。

依据： [事件互调](/Users/wenjia/project/deepwrite/packages/pi-runtime-adapter/src/subagent-events.ts:2)、[迁移反向依赖](/Users/wenjia/project/deepwrite/apps/desktop/src/utilities/folder-catalog-store/migrations.ts:12)、[重试反向依赖](/Users/wenjia/project/deepwrite/apps/desktop/src/renderer/src/composables/agent-conversation/retry-subagent.ts:17)。

**建议：** 先结合 F3 判断相关模块是否应删除。保留的事件转换把纯映射下沉或注入递归回调；迁移与清单共同使用小型内容枚举模块；流刷新和重试状态由上层协调。避免再引入一个同时依赖双方的万能工具文件。

**验收：** 静态运行时图无上述强连通分量；检查器能区分类型边和运行时边，新增循环会阻断 CI。

### F6 · P2 · 边界检查通过不等于完整验证了架构边界

**性质：已用隔离探针证实的规则盲区，不是已发现的生产越权。**

检查器仅扫描 Renderer 的 `.ts/.vue`，通过正则识别部分导入形式；禁用内置模块列表只匹配 `fs` 等裸名称。探针中的 `import fs from "fs/promises"` 与副作用导入 `import "node:fs"` 均未被阻止。它也没有验证跨目录传递依赖、其他进程的依赖方向或整个循环依赖图。

另外，86 个非测试 Renderer 文件仍从根 `@deepwrite/contracts` 导入运行时值，构建依靠 alias 映射到 `renderer.ts`。当前构建通过，未据此认定泄露；但源码、类型检查和构建解析路径存在理解成本，与规范要求的显式 Renderer 入口不一致。

依据： [导入形式正则](/Users/wenjia/project/deepwrite/tools/check-renderer-boundary.mjs:90)、[内置模块名单](/Users/wenjia/project/deepwrite/tools/check-renderer-boundary.mjs:7)、[构建 alias](/Users/wenjia/project/deepwrite/apps/desktop/electron.vite.config.ts:21)、[探针结果](/Users/wenjia/.codex/visualizations/2026/09/11/01a0906e-bc10-7200-86e7-d1f580052454/deepwrite-quality-evidence/boundary-probe.log)。

**建议：** 用 TypeScript/Vue AST 与解析后的模块图检查静态、动态、再导出、裸内置模块子路径和传递边界；运行时值统一使用显式 Renderer 子入口。保持现有 Main 授权和 Zod 运行时校验，静态检查不能替代它们。

**验收：** 本次两种探针及相对路径跨层引用被拒绝；合法类型导入允许通过；源码、类型检查、测试、构建的契约解析保持一致。

### F7 · P2 · 前端测试中源码断言占比高，缺少真实交互证据

**性质：测试保障缺口。**

286 个 Renderer `.test` 文件中，108 个使用 `?raw` 导入源码，占约 37.8%。这是“包含源码断言的文件占比”，不是无效测试占比；有些文件同时包含行为测试，静态守卫也有合理用途。

但自动保存“集成测试”等通过字符串是否出现来判断是否接线，不能证明用户输入、异步事件、组件挂载和实际保存结果。全局 Vitest 使用 Node 环境，扫描未发现 Renderer 测试中的常见 `mount`、`createApp`、Vue Test Utils 或浏览器测试入口。本次没有得到组件实际渲染与交互已被这些测试执行的证据。

依据： [自动保存源码断言](/Users/wenjia/project/deepwrite/apps/desktop/src/renderer/src/App.auto-save.test.ts:11)、[测试环境](/Users/wenjia/project/deepwrite/vitest.config.ts:22)、[文件清单](/Users/wenjia/.codex/visualizations/2026/09/11/01a0906e-bc10-7200-86e7-d1f580052454/deepwrite-quality-evidence/raw-test-files.json)。

**建议：** 保留必要静态守卫，把“用户输入 → 保存”“审阅 → Core 提交”“失败 → 草稿保留”改为执行真实入口的行为测试；再添加少量真实组件或 Electron 交互测试，覆盖弹层、主题、键盘、字号和窗口尺寸。对持久化模块优先覆盖失败分支，不以全仓行覆盖率替代风险判断。

**验收：** 删除或破坏真实保存调用、断开事件接线、故意标错成功状态时，对应测试必须失败；关键交互测试断言用户可见结果或最终文件内容，避免主要断言内部字符串。

### F8 · P2 · CI 尚未验证桌面运行与平台差异

**性质：交付保障缺口；本机冒烟已通过。**

当前工作流仅在 Ubuntu 上运行 `pnpm verify`；`verify` 构建桌面产物，但不调用 Electron 冒烟或退出冒烟。仓库已有测试包与运行脚本，这次本机 Electron 冒烟通过，不过它不能证明 Windows/macOS 的文件替换、锁、路径、退出和打包环境都正常。

依据： [CI 作业](/Users/wenjia/project/deepwrite/.github/workflows/verify.yml:18)、[校验脚本](/Users/wenjia/project/deepwrite/package.json:23)、[已有 Electron 冒烟](/Users/wenjia/project/deepwrite/apps/desktop/scripts/electron-smoke.mjs:87)。

**建议：** PR 主通道增加隔离 userData 的实际桌面启动/退出冒烟；对事务、路径、配置与恢复测试增加 Windows/macOS 作业；耗时安装包验证安排在发布或定期 CI。复用现有脚本和打包入口，按运行成本分层。

**验收：** 缺 Utility 入口、Preload 挂载失败、退出前未完成保存会导致相关作业失败；发布证据包含目标平台的安装包内验证。不要把本次普通冒烟等同于完整 E2E。

### F9 · P2 · 可用态 JavaScript 预算接近上限

**性质：容量预警；不是已测得的卡顿。**

本次构建的严格初始 JavaScript 为 89,954 B；工作台可用态 JavaScript 为 996,487 B 原始大小、286,673 B gzip。现有上限是 1,000,000 B，仅余 **3,513 B，约 0.35%**。指标说明异步壳有效，但进入工作台后仍加载较多代码。

依据： [预算定义](/Users/wenjia/project/deepwrite/tools/check-renderer-build.mjs:11)、[构建日志](/Users/wenjia/.codex/visualizations/2026/09/11/01a0906e-bc10-7200-86e7-d1f580052454/deepwrite-quality-evidence/verify.log)。

**建议：** 沿现有懒加载和契约入口继续缩小工作台依赖，优先检查静态 schema/工具导入带来的附加代码。建议先争取至少 10% 预算余量；同时建立固定机器、固定数据集下的冷启动可编辑时间、大文稿输入和保存延迟基线，再决定优化热点。

**验收：** 保持 1 MB 上限，新增功能不会反复挤占同一入口；保存及输入延迟目标依据实测 p95 制定。包体积不直接代表启动时间或内存，本次不对后两者作结论。

## 提升顺序与实施方式

### 阶段一：优先建立数据安全闭环

处理 F1、F2。先把本次实验转成正式回归用例，再实现提交协议；明确外部编辑的能力边界和恢复策略。按短篇/剧本、长篇、模型配置分别确认写入责任，复用已有 Core 事务与 Main 配置边界。合并前运行 `pnpm verify` 和对应故障矩阵。

退出条件：两个复现场景不再产生未经解释的覆盖或配置错配；恢复路径与错误反馈经过验证。粗略估计 3–6 工程人日，外部编辑协议可能扩大工作量。

### 阶段二：让实际入口、测试与规则一致

处理 F3、F6、F7，并接入 F4 的检查入口。每个 PR 只切换一个可独立验证的职责；切换调用后删除旧实现，避免一边复制拆分一边增加功能。迁移源码测试时逐条确认它保护的用户行为，保留有价值的静态边界测试。

退出条件：两套孤立工厂消失，重要行为测试只通过真实入口验证，边界探针被阻止，新增代码符合现有规则。粗略估计 4–7 工程人日。

### 阶段三：控制后续增长与交付风险

分批推进 Main/目录仓库/提案协调器拆分，消除 F5 循环；落实 F8 平台验证，处理 F9 包体余量并记录性能基线。按文件触达频率和业务风险排序，不对全仓进行统一机械拆分。

退出条件：关键入口职责明显减少，跨平台持久化测试稳定，性能数据可重测。粗略估计 5–10 工程人日，可与正常功能开发穿插。

这些是基于代码结构的规划估计，不是交付承诺。建议以小 PR 和上述退出条件安排约三至四周的改进窗口，避免同时改变协议、存储格式、UI 编排和测试体系。

## 持续跟踪的指标

- 保存、配置、退出、同步四条关键链路中，故障注入场景的通过率与恢复完整性。
- 修改真实入口能被测试捕获的比例；抽样做破坏性变异验证，而非继续累计字符串断言。
- 超限文件的新增数与触达热点的收敛情况；保持新增超限数为零。
- 新增循环依赖与孤立实现数；删除副本后防止回流。
- 实际 Electron 冒烟和目标平台持久化检查状态。
- 可用态 JavaScript 余量、固定数据集下的冷启动和输入/保存 p95。

## 审查限制

本次没有进行全量逐行审查、真实云服务或模型调用、依赖漏洞数据库检索、安装包构建签名、Windows/Linux 运行验证、完整 UI 操作验证、覆盖率采集或大文稿性能基准。未运行 `smoke:shutdown`；普通 `smoke` 不覆盖所有退出场景。未发现问题的模块不能据此视为无缺陷。

F1/F2 的实验通过 Mock 文件系统边界控制竞争和 I/O 失败，足以证明指定执行顺序下的问题，不代表估计了生产发生频率。静态依赖统计没有声称覆盖所有动态加载路径。
