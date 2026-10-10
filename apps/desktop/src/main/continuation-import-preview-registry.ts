import {
  ImportPreviewRegistry,
  type ImportPreviewSource
} from "./import-preview-registry";

export interface ContinuationImportPreviewRegistration extends ImportPreviewSource {
  expiresAt: number;
}

export class ContinuationImportPreviewRegistry extends ImportPreviewRegistry<ImportPreviewSource> {
  constructor(ttlMs = 30 * 60 * 1_000, now: () => number = Date.now) {
    super({
      idPrefix: "continuation-preview",
      expiredMessage: "续写导入预览已失效，请重新选择文件夹。",
      ttlMs,
      now
    });
  }
}
