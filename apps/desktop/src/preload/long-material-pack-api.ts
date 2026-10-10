import {
  CommandEnvelopeSchema,
  LongMaterialApplyGuideInputSchema,
  LongMaterialConvertInputSchema,
  LongMaterialConvertResultSchema,
  LongMaterialInspectInputSchema,
  LongMaterialListInputSchema,
  LongMaterialPackRefInputSchema,
  LongMaterialPackRequestSchema,
  LongMaterialPackSummarySchema,
  LongMaterialPreviewSchema,
  LongMaterialResolveInputSchema,
  LongMaterialSourceStatsSchema,
  createEnvelope,
  type CommandEnvelope,
  type LongMaterialPackApi
} from "@deepwrite/contracts";
import { browserId, invokeCommand } from "./invoke";

async function packInvoke(
  type: CommandEnvelope["type"],
  payload: unknown
): Promise<unknown> {
  const id = browserId("cmd_long_material_pack");
  return invokeCommand(
    CommandEnvelopeSchema.parse(
      createEnvelope(type, payload, { id, correlationId: id })
    )
  );
}

/** 长篇转素材库: each request and response is validated on both sides. */
export const longMaterialPack: LongMaterialPackApi = {
  async inspect(input) {
    return LongMaterialSourceStatsSchema.parse(
      await packInvoke(
        "longMaterialPack.inspect",
        LongMaterialInspectInputSchema.parse(input)
      )
    );
  },
  async preview(input) {
    return LongMaterialPreviewSchema.parse(
      await packInvoke(
        "longMaterialPack.preview",
        LongMaterialPackRequestSchema.parse(input)
      )
    );
  },
  async convert(input) {
    return LongMaterialConvertResultSchema.parse(
      await packInvoke(
        "longMaterialPack.convert",
        LongMaterialConvertInputSchema.parse(input)
      )
    );
  },
  async resolve(input) {
    return LongMaterialConvertResultSchema.parse(
      await packInvoke(
        "longMaterialPack.resolve",
        LongMaterialResolveInputSchema.parse(input)
      )
    );
  },
  async list(input = {}) {
    return LongMaterialPackSummarySchema.array().parse(
      await packInvoke(
        "longMaterialPack.list",
        LongMaterialListInputSchema.parse(input)
      )
    );
  },
  async deleteRecord(input) {
    await packInvoke(
      "longMaterialPack.deleteRecord",
      LongMaterialPackRefInputSchema.parse(input)
    );
  },
  async applyGuide(input) {
    return LongMaterialConvertResultSchema.parse(
      await packInvoke(
        "longMaterialPack.applyGuide",
        LongMaterialApplyGuideInputSchema.parse(input)
      )
    );
  }
};
