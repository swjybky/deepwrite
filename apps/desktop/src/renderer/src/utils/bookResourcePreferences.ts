import type { ResourceTreeSection } from "../types/workspace";

export const BOOK_RESOURCE_PREFERENCES_STORAGE_KEY = "deepwrite:book-resource-preferences";

export interface BookResourcePreference {
  label?: string;
  removed?: boolean;
  skillLibraryIds?: string[];
  materialLibraryIds?: string[];
}

export type BookResourcePreferences = Record<string, BookResourcePreference>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validTopLevelIds(sections: ResourceTreeSection[], sectionId: ResourceTreeSection["id"]): Set<string> {
  return new Set(
    sections.find((section) => section.id === sectionId)?.nodes.map((node) => node.id) ?? []
  );
}

function parseLibraryIds(value: unknown, validIds: Set<string>): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return [...new Set(value.filter((id): id is string => typeof id === "string"))].filter((id) =>
    validIds.has(id)
  );
}

export function parseBookResourcePreferences(
  storedValue: string | null,
  sections: ResourceTreeSection[]
): BookResourcePreferences {
  if (!storedValue) {
    return {};
  }

  try {
    const value: unknown = JSON.parse(storedValue);
    if (!isRecord(value)) {
      return {};
    }

    const bookIds = validTopLevelIds(sections, "creation");
    const skillLibraryIds = validTopLevelIds(sections, "skill");
    const materialLibraryIds = validTopLevelIds(sections, "material");
    const preferences: BookResourcePreferences = {};

    for (const [bookId, rawPreference] of Object.entries(value)) {
      if (!bookIds.has(bookId) || !isRecord(rawPreference)) {
        continue;
      }

      const preference: BookResourcePreference = {};
      if (typeof rawPreference.label === "string" && rawPreference.label.trim()) {
        preference.label = rawPreference.label.trim().slice(0, 80);
      }
      if (rawPreference.removed === true) {
        preference.removed = true;
      }

      const skills = parseLibraryIds(rawPreference.skillLibraryIds, skillLibraryIds);
      const materials = parseLibraryIds(rawPreference.materialLibraryIds, materialLibraryIds);
      if (skills) {
        preference.skillLibraryIds = skills;
      }
      if (materials) {
        preference.materialLibraryIds = materials;
      }
      preferences[bookId] = preference;
    }

    return preferences;
  } catch {
    return {};
  }
}

export function applyBookResourcePreferences(
  sections: ResourceTreeSection[],
  preferences: BookResourcePreferences
): ResourceTreeSection[] {
  return sections.map((section) => {
    if (section.id !== "creation") {
      return section;
    }

    return {
      ...section,
      nodes: section.nodes.flatMap((node) => {
        const preference = preferences[node.id];
        if (preference?.removed) {
          return [];
        }
        return [
          {
            ...node,
            ...(preference?.label ? { label: preference.label } : {}),
            boundSkillLibraryIds: [
              ...(preference?.skillLibraryIds ?? node.boundSkillLibraryIds ?? [])
            ],
            boundMaterialLibraryIds: [
              ...(preference?.materialLibraryIds ?? node.boundMaterialLibraryIds ?? [])
            ]
          }
        ];
      })
    };
  });
}
