export class ModelNotFoundError extends Error {
  constructor() {
    super("所选模型不存在，请刷新模型配置后重试。");
    this.name = "ModelNotFoundError";
  }
}
