import {
  ChooseLibraryPackageSourceInputSchema,
  ChooseLibraryPackageSourceResultSchema,
  CommandEnvelopeSchema,
  DiscardLibraryPackagePreviewInputSchema,
  ExportLibraryPackageInputSchema,
  ExportLibraryPackageResultSchema,
  ImportLibraryPackageInputSchema,
  ImportLibraryPackageResultSchema,
  createEnvelope,
  type CommandEnvelope,
  type LibraryPackageApi
} from "@deepwrite/contracts";
import { browserId, invokeCommand } from "./invoke";

async function packageInvoke(
  type: CommandEnvelope["type"],
  payload: unknown
): Promise<unknown> {
  const id = browserId("cmd_library_package");
  return invokeCommand(
    CommandEnvelopeSchema.parse(
      createEnvelope(type, payload, { id, correlationId: id })
    )
  );
}

/** 素材包/技能包: each request and response is validated on both sides. */
export const libraryPackage: LibraryPackageApi = {
  async exportPackage(input) {
    return ExportLibraryPackageResultSchema.parse(
      await packageInvoke(
        "catalog.exportLibraryPackage",
        ExportLibraryPackageInputSchema.parse(input)
      )
    );
  },
  async chooseSource(input) {
    return ChooseLibraryPackageSourceResultSchema.nullable().parse(
      await packageInvoke(
        "catalog.chooseLibraryPackageSource",
        ChooseLibraryPackageSourceInputSchema.parse(input)
      )
    );
  },
  async importPackage(input) {
    return ImportLibraryPackageResultSchema.parse(
      await packageInvoke(
        "catalog.importLibraryPackage",
        ImportLibraryPackageInputSchema.parse(input)
      )
    );
  },
  async discardPreview(input) {
    await packageInvoke(
      "catalog.discardLibraryPackagePreview",
      DiscardLibraryPackagePreviewInputSchema.parse(input)
    );
  }
};
