import {
  LibraryStructureRequestSchema,
  LibraryStructurePlanSchema,
  LibraryStructureResultSchema,
  type LibraryStructureRequest,
  type LibraryStructurePlan
} from "@deepwrite/contracts";
import {
  CreateUnboundEntryInputSchema,
  CreateUnboundEntryResultSchema,
  type CreateUnboundEntryInput
} from "@deepwrite/contracts";
import {
  createEnvelope,
  ReorderLibraryInputSchema,
  LibraryOrganizationSchema,
  type ReorderLibraryInput
} from "@deepwrite/contracts";
import { browserId, invokeCommand } from "./invoke";
export async function reorderLibrary(raw: ReorderLibraryInput) {
  const input = ReorderLibraryInputSchema.parse(raw);
  const id = browserId("cmd_catalog_reorder_library");
  return LibraryOrganizationSchema.parse(
    await invokeCommand(
      createEnvelope("catalog.reorderLibrary", input, { id, correlationId: id })
    )
  );
}

export async function createUnboundEntry(raw: CreateUnboundEntryInput) {
  const input = CreateUnboundEntryInputSchema.parse(raw);
  const id = browserId("cmd_catalog_unbound_entry");
  return CreateUnboundEntryResultSchema.parse(
    await invokeCommand(
      createEnvelope("catalog.createUnboundEntry", input, {
        id,
        correlationId: id
      })
    )
  );
}

export async function previewLibraryStructure(raw: LibraryStructureRequest) {
  const input = LibraryStructureRequestSchema.parse(raw);
  const id = browserId("cmd_library_preview");
  return LibraryStructurePlanSchema.parse(
    await invokeCommand(
      createEnvelope("catalog.previewLibraryStructure", input, {
        id,
        correlationId: id
      })
    )
  );
}
export async function applyLibraryStructure(raw: LibraryStructurePlan) {
  const input = LibraryStructurePlanSchema.parse(raw);
  const id = browserId("cmd_library_apply");
  return LibraryStructureResultSchema.parse(
    await invokeCommand(
      createEnvelope("catalog.applyLibraryStructure", input, {
        id,
        correlationId: id
      })
    )
  );
}
