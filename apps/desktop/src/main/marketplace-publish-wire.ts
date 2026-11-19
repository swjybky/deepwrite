import {
  type MarketplaceLibraryType,
  type MarketplacePublishInput
} from "@deepwrite/contracts";

export function requestBody(
  input: MarketplacePublishInput
): Record<string, unknown> {
  if (input.contentType === "skill") {
    return {
      title: input.title,
      overview: input.overview,
      stage_id: input.stageId,
      // The published API still requires a value for older desktop clients.
      kind: input.kind ?? "general",
      library_type: input.libraryType,
      content: input.content,
      metadata: { source: "deepwrite-desktop" }
    };
  }
  if (input.contentType === "library") {
    return {
      title: input.title,
      overview: input.overview,
      kind: input.kind,
      library_type: input.libraryType,
      metadata: { source: "deepwrite-desktop" },
      entries: input.entries.map((entry) => ({
        stage_id: entry.stageId,
        title: entry.title,
        body: entry.content
      }))
    };
  }
  return {
    title: input.title,
    overview: input.overview,
    metadata: { source: "deepwrite-desktop" },
    ...("libraries" in input
      ? {
          libraries: input.libraries.map((library) => ({
            title: library.title,
            overview: library.overview,
            kind: library.kind,
            library_type: library.libraryType,
            entries: library.entries.map((entry) => ({
              stage_id: entry.stageId,
              title: entry.title,
              body: entry.content
            }))
          }))
        }
      : {
          items: input.items.map((item) => ({
            item_type: item.contentType,
            item_id: item.id
          }))
        })
  };
}

export function publishPath(
  input: MarketplacePublishInput,
  id?: string
): string {
  const collection =
    input.contentType === "skill"
      ? "skills"
      : input.contentType === "library"
        ? "skill-libraries"
        : "skill-groups";
  return `/market/v1/${collection}${id ? `/${encodeURIComponent(id)}` : ""}`;
}

export function uniqueLibraryTypes(
  values: readonly MarketplaceLibraryType[]
): MarketplaceLibraryType[] {
  return values.filter((value, index) => values.indexOf(value) === index);
}
