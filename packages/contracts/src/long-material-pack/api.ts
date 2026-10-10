import type {
  LongMaterialApplyGuideInput,
  LongMaterialConvertInput,
  LongMaterialResolveInput
} from "./commands";
import type { LongMaterialPackRequest } from "./options";
import type { LongMaterialPackSummary } from "./record";
import type {
  LongMaterialConvertResult,
  LongMaterialPreview,
  LongMaterialSourceStats
} from "./results";

/** `window.deepwrite.longMaterialPack`: every call is validated both ways. */
export interface LongMaterialPackApi {
  inspect(input: { bookId: string }): Promise<LongMaterialSourceStats>;
  preview(input: LongMaterialPackRequest): Promise<LongMaterialPreview>;
  convert(input: LongMaterialConvertInput): Promise<LongMaterialConvertResult>;
  resolve(input: LongMaterialResolveInput): Promise<LongMaterialConvertResult>;
  list(input?: { bookId?: string }): Promise<LongMaterialPackSummary[]>;
  deleteRecord(input: { packId: string }): Promise<void>;
  applyGuide(
    input: LongMaterialApplyGuideInput
  ): Promise<LongMaterialConvertResult>;
}
