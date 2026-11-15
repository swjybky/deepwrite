import {
  LONG_WORLDBUILDING_DIRECTORY_MAX_ITEMS,
  LONG_WORLDBUILDING_DIRECTORY_MAX_ITEMS_PER_CATEGORY,
  type LongWorkspaceRuntimeContext
} from "@deepwrite/contracts";

const LONG_CHARACTER_DIRECTORY_LIMIT_PER_TYPE = 50;

export function renderLongWorldbuildingScopeDirectory(
  navigation: LongWorkspaceRuntimeContext["navigation"]
): string {
  const categories = [...navigation.worldbuilding].sort(
    (left, right) => left.order - right.order || left.id.localeCompare(right.id)
  );
  return categories.length
    ? categories
        .map(
          (category) =>
            `- ${category.title}（category_id=${category.id}；类型=${category.format === "text" ? "文本" : "条目列表"}）`
        )
        .join("\n")
    : "- 暂无世界观分类";
}

export function renderLongCharacterTypeDirectory(
  navigation: LongWorkspaceRuntimeContext["navigation"]
): string {
  const types = [...navigation.characterTypes].sort(
    (left, right) => left.order - right.order || left.id.localeCompare(right.id)
  );
  return types.length
    ? types
        .map((type) => {
          const count = navigation.characters.filter(
            ({ group }) => group === type.id
          ).length;
          return `- ${type.title}（type_id=${type.id}；共 ${count} 人）`;
        })
        .join("\n")
    : "- 暂无人物类型";
}

export function renderLongWorldbuildingDirectory(
  directory: LongWorkspaceRuntimeContext["worldbuildingDirectory"],
  navigation: LongWorkspaceRuntimeContext["navigation"]
): string {
  const categories = directory?.categories ?? [];
  let remaining = LONG_WORLDBUILDING_DIRECTORY_MAX_ITEMS;
  const lines = categories.flatMap((category) => {
    if (category.format === "text") {
      return [
        `- ${category.title}（category_id=${category.categoryId}；类型=文本）`
      ];
    }
    const header = `- ${category.title}（category_id=${category.categoryId}；类型=条目列表；共 ${category.itemCount} 项）`;
    const visible = category.items.slice(
      0,
      Math.min(remaining, LONG_WORLDBUILDING_DIRECTORY_MAX_ITEMS_PER_CATEGORY)
    );
    remaining -= visible.length;
    const items = visible.length
      ? visible.map(
          (item) =>
            `  - ${item.title}（item_id=${item.itemId}；顺序=${item.order}）`
        )
      : category.itemCount
        ? []
        : ["  - 暂无条目"];
    const omitted = category.itemCount - visible.length;
    if (omitted > 0) {
      items.push(
        `  - 另有 ${omitted} 项未进入固定上下文，需要时调用 list（stage=worldbuilding, scope_id=${category.categoryId}）查询。`
      );
    }
    return [header, ...items];
  });
  const includedCategoryIds = new Set(
    categories.map(({ categoryId }) => categoryId)
  );
  const omittedCategories = navigation.worldbuilding
    .filter(({ id }) => !includedCategoryIds.has(id))
    .sort(
      (left, right) =>
        left.order - right.order || left.id.localeCompare(right.id)
    );
  for (const category of omittedCategories) {
    lines.push(
      `- ${category.title}（category_id=${category.id}；类型=${category.format === "text" ? "文本" : "条目列表"}；二层内容未注入，需要时调用 list（stage=worldbuilding, scope_id=${category.id}））`
    );
  }
  return lines.length ? lines.join("\n") : "- 暂无世界观分类";
}

export function renderLongCharacterDirectory(
  navigation: LongWorkspaceRuntimeContext["navigation"]
): string {
  const types = [...navigation.characterTypes].sort(
    (left, right) => left.order - right.order || left.id.localeCompare(right.id)
  );
  const knownTypeIds = new Set(types.map((characterType) => characterType.id));
  const extraGroups = [
    ...new Set(
      navigation.characters
        .map((character) => character.group)
        .filter((group) => !knownTypeIds.has(group))
    )
  ].sort((left, right) => left.localeCompare(right));
  const sections = [
    ...types.map((characterType) => ({
      typeId: characterType.id,
      title: characterType.title
    })),
    ...extraGroups.map((group) => ({
      typeId: group,
      title: group
    }))
  ];
  const lines = sections.flatMap((section) => {
    const characters = navigation.characters
      .filter((character) => character.group === section.typeId)
      .sort(
        (left, right) =>
          left.order - right.order || left.id.localeCompare(right.id)
      );
    const visible = characters.slice(
      0,
      LONG_CHARACTER_DIRECTORY_LIMIT_PER_TYPE
    );
    const header = `- ${section.title}（type_id=${section.typeId}；共 ${characters.length} 人）`;
    const items = visible.length
      ? visible.map(
          (character) =>
            `  - ${character.name}（id=${character.id}；顺序=${character.order}）`
        )
      : ["  - 暂无条目"];
    const omitted = characters.length - visible.length;
    if (omitted > 0) {
      items.push(
        `  - 另有 ${omitted} 人未进入固定上下文，需要时调用 list（stage=character, scope_id=${section.typeId}）查询。`
      );
    }
    return [header, ...items];
  });
  return lines.length ? lines.join("\n") : "- 暂无人物类型";
}
