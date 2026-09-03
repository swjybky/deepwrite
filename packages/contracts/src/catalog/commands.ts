import { z } from "zod";

import { EnvelopeBaseSchema } from "../envelope";
import { CatalogInstallMarketplaceSkillContentCommandEnvelopeSchema } from "../marketplace";
import {
  CatalogOpenProjectInputSchema,
  CatalogReadDocumentInputSchema,
  CreateDraftSectionInputSchema,
  CreateDraftSectionsInputSchema,
  CreateLibraryAtPathInputSchema,
  CreateLibraryEntryInputSchema,
  CreateLibraryGroupAtPathInputSchema,
  CreateLibraryGroupInputSchema,
  CreateLibraryInputSchema,
  CreateScriptBookAtPathInputSchema,
  CreateScriptBookInputSchema,
  CreateShortBookAtPathInputSchema,
  CreateShortBookInputSchema,
  DeleteBookInputSchema,
  DeleteCatalogProjectInputSchema,
  DeleteDraftSectionInputSchema,
  DuplicateCatalogProjectInputSchema,
  ExternalLibrarySourceKindSchema,
  ImportLibraryEntriesInputSchema,
  ImportLegacyBookAtPathInputSchema,
  ImportLegacyLibraryAtPathInputSchema,
  ImportLegacyLibraryInputSchema,
  MoveDraftSectionInputSchema,
  MoveLibraryEntryInputSchema,
  MutateCharacterStructureInputSchema,
  MutatePlotStructureInputSchema,
  OpenCatalogProjectAtPathInputSchema,
  RemoveLibraryEntryInputSchema,
  SaveDocumentInputSchema,
  SaveLibraryEntryInputSchema,
  UnregisterCatalogProjectInputSchema,
  UpdateBookInputSchema,
  UpdateLibraryGroupInputSchema,
  UpdateLibraryInputSchema
} from "./mutations";
import { CatalogDraftRecoverySchema } from "./snapshot";

export const CatalogSnapshotCommandEnvelopeSchema = EnvelopeBaseSchema.extend({
  type: z.literal("catalog.snapshot"),
  payload: z.object({})
});

export const CatalogIndexCommandEnvelopeSchema = EnvelopeBaseSchema.extend({
  type: z.literal("catalog.index"),
  payload: z.object({}).strict()
});

export const CatalogReadDocumentCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("catalog.readDocument"),
    payload: CatalogReadDocumentInputSchema
  });

export const CatalogLoadDraftRecoveryCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("catalog.loadDraftRecovery"),
    payload: z.object({})
  });

export const CatalogSaveDraftRecoveryCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("catalog.saveDraftRecovery"),
    payload: z.object({ drafts: CatalogDraftRecoverySchema })
  });

export const CatalogCreateShortBookCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("catalog.createShortBook"),
    payload: CreateShortBookInputSchema
  });

export const CatalogCreateScriptBookCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("catalog.createScriptBook"),
    payload: CreateScriptBookInputSchema
  });

export const CatalogCreateLibraryCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("catalog.createLibrary"),
    payload: CreateLibraryInputSchema
  });

export const CatalogUpdateLibraryCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("catalog.updateLibrary"),
    payload: UpdateLibraryInputSchema
  });

export const CatalogCreateLibraryGroupCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("catalog.createLibraryGroup"),
    payload: CreateLibraryGroupInputSchema
  });

export const CatalogOpenProjectCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("catalog.openProject"),
    payload: CatalogOpenProjectInputSchema
  });

export const CatalogImportLegacyBookCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("catalog.importLegacyBook"),
    payload: z.object({})
  });

export const CatalogImportLegacyLibraryCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("catalog.importLegacyLibrary"),
    payload: ImportLegacyLibraryInputSchema
  });

export const CatalogCreateShortBookAtPathCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("catalog.createShortBookAtPath"),
    payload: CreateShortBookAtPathInputSchema
  });

export const CatalogCreateScriptBookAtPathCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("catalog.createScriptBookAtPath"),
    payload: CreateScriptBookAtPathInputSchema
  });

export const CatalogCreateLibraryAtPathCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("catalog.createLibraryAtPath"),
    payload: CreateLibraryAtPathInputSchema
  });

export const CatalogCreateLibraryGroupAtPathCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("catalog.createLibraryGroupAtPath"),
    payload: CreateLibraryGroupAtPathInputSchema
  });

export const CatalogOpenProjectAtPathCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("catalog.openProjectAtPath"),
    payload: OpenCatalogProjectAtPathInputSchema
  });

export const CatalogImportLegacyBookAtPathCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("catalog.importLegacyBookAtPath"),
    payload: ImportLegacyBookAtPathInputSchema
  });

export const CatalogImportLegacyLibraryAtPathCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("catalog.importLegacyLibraryAtPath"),
    payload: ImportLegacyLibraryAtPathInputSchema
  });

export const CatalogUpdateBookCommandEnvelopeSchema = EnvelopeBaseSchema.extend(
  {
    type: z.literal("catalog.updateBook"),
    payload: UpdateBookInputSchema
  }
);

export const CatalogMutatePlotStructureCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("catalog.mutatePlotStructure"),
    payload: MutatePlotStructureInputSchema
  });

export const CatalogMutateCharacterStructureCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("catalog.mutateCharacterStructure"),
    payload: MutateCharacterStructureInputSchema
  });

export const CatalogUpdateLibraryGroupCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("catalog.updateLibraryGroup"),
    payload: UpdateLibraryGroupInputSchema
  });

export const CatalogDeleteBookCommandEnvelopeSchema = EnvelopeBaseSchema.extend(
  {
    type: z.literal("catalog.deleteBook"),
    payload: DeleteBookInputSchema
  }
);

export const CatalogSaveDocumentCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("catalog.saveDocument"),
    payload: SaveDocumentInputSchema
  });

export const CatalogCreateDraftSectionCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("catalog.createDraftSection"),
    payload: CreateDraftSectionInputSchema
  });

export const CatalogCreateDraftSectionsCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("catalog.createDraftSections"),
    payload: CreateDraftSectionsInputSchema
  });

export const CatalogDeleteDraftSectionCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("catalog.deleteDraftSection"),
    payload: DeleteDraftSectionInputSchema
  });

export const CatalogMoveDraftSectionCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("catalog.moveDraftSection"),
    payload: MoveDraftSectionInputSchema
  });

export const CatalogSaveLibraryEntryCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("catalog.saveLibraryEntry"),
    payload: SaveLibraryEntryInputSchema
  });

export const CatalogCreateLibraryEntryCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("catalog.createLibraryEntry"),
    payload: CreateLibraryEntryInputSchema
  });

export const CatalogRemoveLibraryEntryCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("catalog.removeLibraryEntry"),
    payload: RemoveLibraryEntryInputSchema
  });

export const CatalogMoveLibraryEntryCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("catalog.moveLibraryEntry"),
    payload: MoveLibraryEntryInputSchema
  });

export const CatalogUnregisterProjectCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("catalog.unregisterProject"),
    payload: UnregisterCatalogProjectInputSchema
  });

export const CatalogDeleteProjectCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("catalog.deleteProject"),
    payload: DeleteCatalogProjectInputSchema
  });

export const CatalogDuplicateProjectCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("catalog.duplicateProject"),
    payload: DuplicateCatalogProjectInputSchema
  });

export const CatalogChooseExternalLibraryEntriesCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("catalog.chooseExternalLibraryEntries"),
    payload: z.object({ sourceKind: ExternalLibrarySourceKindSchema })
  });

export const CatalogImportLibraryEntriesCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("catalog.importLibraryEntries"),
    payload: ImportLibraryEntriesInputSchema
  });

export const CatalogCommandEnvelopeSchema = z.discriminatedUnion("type", [
  CatalogIndexCommandEnvelopeSchema,
  CatalogReadDocumentCommandEnvelopeSchema,
  CatalogSnapshotCommandEnvelopeSchema,
  CatalogLoadDraftRecoveryCommandEnvelopeSchema,
  CatalogSaveDraftRecoveryCommandEnvelopeSchema,
  CatalogCreateShortBookCommandEnvelopeSchema,
  CatalogCreateScriptBookCommandEnvelopeSchema,
  CatalogCreateLibraryCommandEnvelopeSchema,
  CatalogUpdateLibraryCommandEnvelopeSchema,
  CatalogCreateLibraryGroupCommandEnvelopeSchema,
  CatalogOpenProjectCommandEnvelopeSchema,
  CatalogImportLegacyLibraryCommandEnvelopeSchema,
  CatalogCreateShortBookAtPathCommandEnvelopeSchema,
  CatalogCreateScriptBookAtPathCommandEnvelopeSchema,
  CatalogCreateLibraryAtPathCommandEnvelopeSchema,
  CatalogCreateLibraryGroupAtPathCommandEnvelopeSchema,
  CatalogOpenProjectAtPathCommandEnvelopeSchema,
  CatalogImportLegacyLibraryAtPathCommandEnvelopeSchema,
  CatalogUpdateBookCommandEnvelopeSchema,
  CatalogMutatePlotStructureCommandEnvelopeSchema,
  CatalogMutateCharacterStructureCommandEnvelopeSchema,
  CatalogUpdateLibraryGroupCommandEnvelopeSchema,
  CatalogDeleteBookCommandEnvelopeSchema,
  CatalogSaveDocumentCommandEnvelopeSchema,
  CatalogCreateDraftSectionCommandEnvelopeSchema,
  CatalogCreateDraftSectionsCommandEnvelopeSchema,
  CatalogDeleteDraftSectionCommandEnvelopeSchema,
  CatalogMoveDraftSectionCommandEnvelopeSchema,
  CatalogSaveLibraryEntryCommandEnvelopeSchema,
  CatalogCreateLibraryEntryCommandEnvelopeSchema,
  CatalogRemoveLibraryEntryCommandEnvelopeSchema,
  CatalogMoveLibraryEntryCommandEnvelopeSchema,
  CatalogUnregisterProjectCommandEnvelopeSchema,
  CatalogDeleteProjectCommandEnvelopeSchema,
  CatalogDuplicateProjectCommandEnvelopeSchema,
  CatalogInstallMarketplaceSkillContentCommandEnvelopeSchema,
  CatalogChooseExternalLibraryEntriesCommandEnvelopeSchema,
  CatalogImportLibraryEntriesCommandEnvelopeSchema
]);
export type CatalogCommandEnvelope = z.infer<
  typeof CatalogCommandEnvelopeSchema
>;
