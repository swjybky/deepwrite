export default {
  permissions: "权限",
  approvalLabel: "智能体默认审批方式",
  requestApproval: "请求批准",
  requestApprovalDescription: "智能体修改或写入正文前，需要由你确认。",
  autoApproval: "替我审批",
  autoApprovalDescription:
    "智能体产生写入后立即自动批准，并在后台串行保存。自动审批可能会出错。",
  crossStageApproval: "跨阶段操作自动审批",
  crossStageApprovalDescription:
    "开启后，主智能体和子智能体的跨阶段操作将自动允许，不再逐笔询问；变更提案仍按上方审批方式处理。",
  general: "常规",
  autoSave: "自动保存",
  autoSaveDescription: "文稿发生变化并停止输入片刻后，自动保存到本机",
  layout: "页面布局",
  layoutDescription: "调整创作空间中智能体与文本内容的位置",
  layoutLabel: "选择创作空间页面布局",
  agentFirst: "目录｜智能体｜文本内容",
  editorFirst: "目录｜文本内容｜智能体",
  language: "语言",
  languageDescription: "选择应用界面语言；不会更改作品正文或自定义内容",
  languageLabel: "选择应用语言",
  systemLanguage: "跟随系统",
  simplifiedChinese: "简体中文",
  english: "English",
  menuBar: "在菜单栏中显示",
  menuBarDescription: "关闭主窗口后，仍在菜单栏中保留应用图标",
  network: "网络设置",
  proxy: "网络代理",
  proxyDescription:
    "默认直连模型服务。开启后使用系统或环境变量中的 HTTP 代理，适合需要 VPN 的接口。",
  saveFailedDetail: "常规设置已在本次运行中生效，但写入本机失败：{message}",
  moreFeaturesSaveFailed:
    "更多功能配置保存失败，已恢复为上次保存的显示与顺序。",
  moreFeaturesSaveFailedDetail:
    "更多功能配置保存失败，已恢复为上次保存的显示与顺序：{message}",
  saveFailed: "常规设置已在本次运行中生效，但暂时无法写入本机",
  loadFailed: "加载常规设置失败，已使用默认设置",
  autoSaveFailed: "自动保存设置已生效，但暂时无法写入本机配置",
  catalogConflict: "本地文件已在其他位置更新，请重新加载后核对修改。",
  modelContentBlocked:
    "模型服务因内容限制中止了生成（{reason}）。请检查提示词、会话历史和作品上下文；若普通内容也频繁触发，请联系模型或反代服务确认限制。原样重试可能再次被拦截。",
  conversationStoragePermissionDenied:
    "用户数据目录无法写入，请检查文件夹权限（{code}）。",
  conversationStorageDiskFull: "用户数据磁盘空间不足（{code}）。",
  conversationStorageLocked: "会话数据库正被占用，请稍后重试（{code}）。",
  conversationStorageCorrupt:
    "会话数据库无法读取，请保留用户数据目录并联系开发者修复（{code}）。",
  conversationStorageLocationUnavailable:
    "用户数据目录或会话数据库无法打开，请检查目录及磁盘连接（{code}）。",
  conversationStorageIoFailed:
    "用户数据磁盘读写失败，请检查磁盘状态（{code}）。",
  conversationStorageWorkerUnavailable: "会话存储服务启动失败（{code}）。",
  conversationStorageMigrationFailed:
    "旧会话导入未完成，原始记录已保留（{code}）。",
  conversationStorageFailed: "本地会话保存或读取失败（{code}）。",
  impactChanged: "关联关系或删除影响已变化，请核对最新影响后再次确认。",
  targetNotFound: "目标条目已不存在，请刷新后重试。",
  targetExists: "同名目标已存在，请检查后重试。",
  invalidReference: "引用的条目已变化或不再可用，请刷新后重试。",
  invalidOrder: "条目顺序已失效，请刷新后重试。",
  recordedChapterOrder:
    "已写入连续性账本的章节位置固定，其他章节也不能越过它们调整顺序。",
  invalidDocumentWrite: "文稿写入内容已失效，请基于最新版本重新生成。",
  invalidOperationResult: "结构操作返回了无效结果，请刷新后重试。",
  ledgerAuditFailed: "连续性账本与当前章节不一致，请刷新工作区并核对后重试。",
  settingsStillLoading: "常规设置仍在加载，请稍后再关闭或迁移。",
  settingsNotSaved: "常规设置尚未保存，已取消关闭或迁移，请重试。",
  languageResourcesFailed:
    "应用语言资源加载失败，请重试。若问题持续，请重新安装应用。",
  retryStartup: "重新加载"
};
