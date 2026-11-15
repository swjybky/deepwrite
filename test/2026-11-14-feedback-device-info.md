# 反馈自动附带设备信息

## 目标与成功标准

- 提交反馈自动附带电脑型号与当前软件版本，DeepwriteApi 保存并在管理后台显示。
- 型号读取失败仍可提交；旧客户端、旧反馈数据继续兼容。

## 环境

- macOS 本地 DeepWrite 与相邻 DeepwriteApi 工作区；合成反馈与临时数据库。
- 两个工作区已有其他未提交改动，本次只修改反馈相关文件。

## 步骤与命令（L1 / L2）

- DeepWrite：反馈 client 与 device-model 两个 Vitest 文件，共 11 项测试。
- 改动文件 ESLint、Prettier；`pnpm lint:boundary`、`pnpm typecheck`、`pnpm build`、`pnpm smoke`。
- Node 调用实际 `readFeedbackDeviceModel()`，仅断言非空，不留存本机型号。
- DeepwriteApi：`go test ./internal/httpapi -run 'Test.*Feedback|TestAdminRepliesAndUserSeesStatus' -count=1`。
- DeepwriteApi：`go test ./internal/database -run TestFeedbackDeviceModelMigration -count=1`。
- DeepwriteApi：`npm run typecheck`、反馈管理页 ESLint。

## 结果

- 上述检查通过；桌面请求包含 `client_device_model`，保留 Main 提供的 `client_version` 和 `client_platform`。
- macOS 使用硬件型号；Windows 使用 CIM 厂商与型号；Linux 使用 DMI 厂商与产品名称。
- 命令限制 3 秒；型号最多 128 字符，读取失败传空字符串。
- 服务端验证覆盖型号保存、空值与缺省兼容、长度截断、管理接口返回及旧数据迁移保留。
- 迁移测试首次因夹具缺少关联用户失败；补齐合成用户后复测通过。
- 后台列表与详情复用现有客户端信息区域显示型号，未改样式。

## 未覆盖与后续

- Windows / Linux 实机型号读取、管理后台视觉验收、真实线上反馈提交未验；平台分支已模拟测试。
- 未发布、未部署。上线需先部署包含 000033 数据库迁移的 DeepwriteApi，再分发桌面新版。
