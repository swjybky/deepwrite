<script setup lang="ts">
import { formatError } from "../i18n/errors";
import { createScopedTranslator } from "../i18n";
import { computed, onMounted, ref, watch } from "vue";
import {
  MARKETPLACE_CONTENT_MAX_CHARACTERS,
  type CatalogSnapshot,
  type MarketplaceContentDetail,
  type MarketplaceContentRef,
  type MarketplaceContentSummary,
  type MarketplaceContentType,
  type MarketplaceInstallPreview,
  type MarketplaceLibraryType,
  type MarketplaceListFilter,
  type MarketplacePublishEntry,
  type MarketplacePublishGroupLibrary,
  type MarketplacePublishInput,
  type MarketplaceSession,
  type MarketplaceSkillDetail,
  type MarketplaceSkillKind,
  type MarketplaceSkillStage
} from "@deepwrite/contracts/renderer";
import MarketplaceAuthForm from "./MarketplaceAuthForm.vue";
import MarketplaceBindEmail from "./MarketplaceBindEmail.vue";
import AppIcon from "./AppIcon.vue";
import MarkdownContent from "./MarkdownContent.vue";
import PopupSelect, {
  type PopupSelectOption,
  type PopupSelectValue
} from "./PopupSelect.vue";
import { uiMessage } from "../ui-feedback";
import {
  formatMarketplaceContractError,
  formatMarketplacePublishEmptyContentMessage,
  loadMarketplacePublishLibraryContent,
  loadMarketplacePublishLibraryOverview,
  loadMarketplacePublishSkillContent,
  skillLibraryPublishSource,
  type MarketplacePublishDocumentReader
} from "../utils/marketplacePublishContent";

const t = createScopedTranslator("components.skillMarketplacePage");

const props = defineProps<{
  active: boolean;
  catalogSnapshot: CatalogSnapshot | null;
  initialSession?: MarketplaceSession | null;
}>();

const emit = defineEmits<{
  expandSidebar: [];
  refreshCatalog: [];
  sessionChange: [session: MarketplaceSession];
}>();

type PageTab = "browse" | "mine" | "publish";
type DetailSkillSection = {
  id: string;
  title: string;
  kind: MarketplaceSkillKind;
  skills: MarketplaceSkillDetail[];
};

const CONTENT_TYPE_LABELS: Record<MarketplaceContentType, string> = {
  get group() {
    return t("skillGroup");
  },
  get library() {
    return t("skillLibrary");
  },
  get skill() {
    return t("singleSkill");
  }
};
const KIND_LABELS: Record<MarketplaceSkillKind, string> = {
  get style() {
    return t("writingStyle");
  },
  get general() {
    return t("general");
  },
  get plot() {
    return t("plot");
  },
  get other() {
    return t("other");
  }
};
const STATUS_LABELS: Record<string, string> = {
  get draft() {
    return t("draft");
  },
  get pending() {
    return t("pendingReview");
  },
  get published() {
    return t("published");
  },
  get rejected() {
    return t("rejected");
  },
  get archived() {
    return t("archived");
  },
  get deleted() {
    return t("deleted");
  }
};

const contentTypeOptions: PopupSelectOption[] = [
  {
    value: "",
    get label() {
      return t("allContent");
    }
  },
  {
    value: "group",
    get label() {
      return t("skillGroup");
    }
  },
  {
    value: "library",
    get label() {
      return t("skillLibrary");
    }
  },
  {
    value: "skill",
    get label() {
      return t("singleSkill");
    }
  }
];
const kindOptions: PopupSelectOption[] = [
  {
    value: "",
    get label() {
      return t("allCategories");
    }
  },
  ...(Object.keys(KIND_LABELS) as Array<keyof typeof KIND_LABELS>).map(
    (value) => ({
      value,
      get label() {
        return KIND_LABELS[value];
      }
    })
  )
];
const sortOptions: PopupSelectOption[] = [
  {
    value: "latest",
    get label() {
      return t("newest");
    }
  },
  {
    value: "popular",
    get label() {
      return t("popular");
    }
  },
  {
    value: "downloads",
    get label() {
      return t("mostDownloaded");
    }
  },
  {
    value: "likes",
    get label() {
      return t("mostLiked");
    }
  }
];
const publishTypeOptions: PopupSelectOption[] = [
  {
    value: "skill",
    get label() {
      return t("publishSkill");
    }
  },
  {
    value: "library",
    get label() {
      return t("publishSkillLibrary");
    }
  },
  {
    value: "group",
    get label() {
      return t("publishSkillGroup");
    }
  }
];

const session = ref<MarketplaceSession | null>(props.initialSession ?? null);
const pageTab = ref<PageTab>("browse");
const loading = ref(false);
const mineLoading = ref(false);
const browseItems = ref<MarketplaceContentSummary[]>([]);
const mineItems = ref<MarketplaceContentSummary[]>([]);
const PAGE_SIZE = 20;
const browsePage = ref(1);
const browseTotal = ref(0);
const browseTotalPages = ref(0);
const minePage = ref(1);
const mineTotal = ref(0);
const mineTotalPages = ref(0);
const query = ref("");
const contentType = ref<PopupSelectValue>("");
const kind = ref<PopupSelectValue>("");
const sort = ref<PopupSelectValue>("latest");
const detail = ref<MarketplaceContentDetail | null>(null);
const detailSummary = ref<MarketplaceContentSummary | null>(null);
const detailPending = ref(false);
const detailSkills = ref<MarketplaceSkillDetail[]>([]);
const detailSkillSections = ref<DetailSkillSection[]>([]);
const selectedDetailSectionId = ref("");
const selectedDetailSkillId = ref("");
const installPreview = ref<MarketplaceInstallPreview | null>(null);
const installTargetLibraryId = ref("");
const installPending = ref(false);
const deleteTarget = ref<MarketplaceContentSummary | null>(null);
const deletePending = ref(false);
const enabledPendingKey = ref("");

const publishType = ref<MarketplaceContentType>("skill");
const publishSourceId = ref("");
const publishTitle = ref("");
const publishOverview = ref("");
const publishKind = ref<MarketplaceSkillKind>("other");
const publishLibraryType = ref<MarketplaceLibraryType>("short");
const publishStageId = ref<MarketplaceSkillStage>("draft");
const publishBody = ref("");
const publishEntries = ref<MarketplacePublishEntry[]>([]);
const publishGroupLibraries = ref<MarketplacePublishGroupLibrary[]>([]);
const publishGroupItems = ref<MarketplaceContentRef[]>([]);
const publishGroupItemLabels = ref<Record<string, string>>({});
const publishPending = ref(false);
const publishSourceLoading = ref(false);
const editingRef = ref<MarketplaceContentRef | null>(null);
let publishSourceLoadToken = 0;

const apiAvailable = computed(() => Boolean(window.deepwrite?.marketplace));
const authenticated = computed(() => session.value?.authenticated === true);
const insecureTransport = computed(
  () => session.value?.insecureTransport === true
);
const browseDisplayTotalPages = computed(() =>
  Math.max(1, browseTotalPages.value)
);
const mineDisplayTotalPages = computed(() => Math.max(1, mineTotalPages.value));
const visibleMineItems = computed(() =>
  mineItems.value.filter(
    (item) =>
      !("source_library_id" in item.metadata) &&
      !("source_group_id" in item.metadata)
  )
);
const SKILL_GROUP_KIND_ORDER = ["general", "plot", "style", "other"] as const;

const installTargetLibraryOptions = computed<PopupSelectOption[]>(() => {
  const preview = installPreview.value;
  const bucket = preview?.buckets[0];
  if (!preview || preview.ref.contentType !== "skill" || !bucket) return [];
  return (props.catalogSnapshot?.skills ?? [])
    .filter((library) => !library.isBuiltin)
    .map((library) => ({
      value: library.id,
      label: library.title,
      description: t("valueValueValueSkills", {
        arg0: KIND_LABELS[library.skillKind],
        arg2: library.entries.length
      })
    }));
});

const localSkillEntryOptions = computed<PopupSelectOption[]>(() =>
  (props.catalogSnapshot?.skills ?? [])
    .filter((library) => !library.isBuiltin)
    .flatMap((library) =>
      library.entries.map((entry) => ({
        value: `${library.id}\u0000${entry.id}`,
        label: entry.title,
        description: `${library.title} · ${KIND_LABELS[library.skillKind]}`
      }))
    )
);

const localSkillLibraryOptions = computed<PopupSelectOption[]>(() =>
  (props.catalogSnapshot?.skills ?? [])
    .filter((library) => !library.isBuiltin && library.entries.length > 0)
    .map((library) => ({
      value: library.id,
      label: library.title,
      description: t("valueValueValueSkills", {
        arg0: KIND_LABELS[library.skillKind],
        arg2: library.entries.length
      })
    }))
);

function localLibrariesForGroup(groupId: string) {
  const snapshot = props.catalogSnapshot;
  const group = snapshot?.skillGroups.find(({ id }) => id === groupId);
  if (!snapshot || !group) return [];
  return SKILL_GROUP_KIND_ORDER.flatMap((kind) => {
    const libraryId = group.members[kind];
    if (!libraryId) return [];
    const library = snapshot.skills.find(({ id }) => id === libraryId);
    return library && !library.isBuiltin && library.entries.length > 0
      ? [library]
      : [];
  });
}

const localSkillGroupOptions = computed<PopupSelectOption[]>(() =>
  (props.catalogSnapshot?.skillGroups ?? []).flatMap((group) => {
    const memberIds = SKILL_GROUP_KIND_ORDER.flatMap((kind) =>
      group.members[kind] ? [group.members[kind]] : []
    );
    const libraries = localLibrariesForGroup(group.id);
    if (libraries.length === 0 || libraries.length !== memberIds.length)
      return [];
    return [
      {
        value: group.id,
        label: group.title,
        description: t("valueSkillLibrariesValueSkills", {
          arg0: libraries.length,
          arg1: libraries.reduce(
            (total, library) => total + library.entries.length,
            0
          )
        })
      }
    ];
  })
);

const currentSourceOptions = computed(() =>
  publishType.value === "skill"
    ? localSkillEntryOptions.value
    : publishType.value === "library"
      ? localSkillLibraryOptions.value
      : localSkillGroupOptions.value
);

const selectedDetailSection = computed(
  () =>
    detailSkillSections.value.find(
      ({ id }) => id === selectedDetailSectionId.value
    ) ??
    detailSkillSections.value[0] ??
    null
);
const visibleDetailSkills = computed(() =>
  detail.value?.contentType === "group"
    ? (selectedDetailSection.value?.skills ?? [])
    : detailSkills.value
);
const selectedDetailSkill = computed(
  () =>
    visibleDetailSkills.value.find(
      ({ id }) => id === selectedDetailSkillId.value
    ) ??
    visibleDetailSkills.value[0] ??
    null
);

function selectDetailSection(section: DetailSkillSection): void {
  selectedDetailSectionId.value = section.id;
  selectedDetailSkillId.value = section.skills[0]?.id ?? "";
}

function errorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return formatError(error, fallback);
  const cleaned = error.message
    .replace(
      /^Error invoking remote method '[^']+': (?:[A-Za-z_$][\w$]*Error|Error):\s*/u,
      ""
    )
    .replace(/^Error:\s*/u, "");
  return formatMarketplaceContractError(cleaned) ?? cleaned;
}

function catalogDocumentReader(): MarketplacePublishDocumentReader | null {
  const reader = window.deepwrite?.catalog;
  return reader?.readDocument ? reader : null;
}

function updateSession(nextSession: MarketplaceSession): MarketplaceSession {
  session.value = nextSession;
  emit("sessionChange", nextSession);
  return nextSession;
}

async function refreshSessionAfterError(): Promise<void> {
  try {
    updateSession(await window.deepwrite!.marketplace.session());
  } catch {
    // Preserve the current view when even session recovery is unreachable.
  }
}

async function restoreSession(): Promise<void> {
  if (!apiAvailable.value) return;
  loading.value = true;
  try {
    const restoredSession = updateSession(
      await window.deepwrite!.marketplace.session()
    );
    if (restoredSession.authenticated) {
      await Promise.all([loadBrowse(), loadMine()]);
    }
  } catch (error: unknown) {
    uiMessage.error(
      errorMessage(error, t("couldNotRestoreMarketplaceSession"))
    );
  } finally {
    loading.value = false;
  }
}

async function authenticatedSession(next: MarketplaceSession): Promise<void> {
  updateSession(next);
  await Promise.all([loadBrowse(), loadMine()]);
}

async function logout(): Promise<void> {
  if (!apiAvailable.value) return;
  try {
    updateSession(await window.deepwrite!.marketplace.logout());
    detail.value = null;
    browseItems.value = [];
    mineItems.value = [];
    browsePage.value = 1;
    browseTotal.value = 0;
    browseTotalPages.value = 0;
    minePage.value = 1;
    mineTotal.value = 0;
    mineTotalPages.value = 0;
    uiMessage.success(t("signedOutOfTheMarketplace"));
  } catch (error: unknown) {
    uiMessage.error(errorMessage(error, t("couldNotSignOut")));
  }
}

function listFilter(page = browsePage.value): MarketplaceListFilter {
  return {
    ...(query.value.trim() ? { query: query.value.trim() } : {}),
    ...(contentType.value
      ? { contentType: contentType.value as MarketplaceContentType }
      : {}),
    ...(kind.value ? { kind: kind.value as MarketplaceSkillKind } : {}),
    sort: sort.value as MarketplaceListFilter["sort"],
    page,
    pageSize: PAGE_SIZE
  };
}

async function loadBrowse(page = browsePage.value): Promise<void> {
  if (!authenticated.value || !apiAvailable.value) return;
  loading.value = true;
  try {
    const result = await window.deepwrite!.marketplace.list(listFilter(page));
    browseItems.value = result.items;
    browsePage.value = result.page;
    browseTotal.value = result.total;
    browseTotalPages.value = result.totalPages;
  } catch (error: unknown) {
    await refreshSessionAfterError();
    uiMessage.error(errorMessage(error, t("couldNotLoadTheMarketplace")));
  } finally {
    loading.value = false;
  }
}

async function loadMine(page = minePage.value): Promise<void> {
  if (!authenticated.value || !apiAvailable.value) return;
  mineLoading.value = true;
  try {
    const result = await window.deepwrite!.marketplace.listMine({
      page,
      pageSize: PAGE_SIZE
    });
    mineItems.value = result.items;
    minePage.value = result.page;
    mineTotal.value = result.total;
    mineTotalPages.value = result.totalPages;
  } catch (error: unknown) {
    await refreshSessionAfterError();
    uiMessage.error(errorMessage(error, t("couldNotLoadYourPublications")));
  } finally {
    mineLoading.value = false;
  }
}

async function changeBrowsePage(page: number): Promise<void> {
  const nextPage = Math.min(Math.max(1, page), browseDisplayTotalPages.value);
  if (nextPage === browsePage.value || loading.value) return;
  await loadBrowse(nextPage);
}

async function changeMinePage(page: number): Promise<void> {
  const nextPage = Math.min(Math.max(1, page), mineDisplayTotalPages.value);
  if (nextPage === minePage.value || mineLoading.value) return;
  await loadMine(nextPage);
}

async function selectTab(tab: PageTab): Promise<void> {
  pageTab.value = tab;
  if (tab === "browse" && browseItems.value.length === 0) await loadBrowse();
  if ((tab === "mine" || tab === "publish") && mineItems.value.length === 0) {
    await loadMine();
  }
}

async function openDetail(
  item: MarketplaceContentSummary,
  owned = false
): Promise<void> {
  if (!apiAvailable.value || detailPending.value) return;
  detailPending.value = true;
  detailSummary.value = item;
  try {
    const ref = { contentType: item.contentType, id: item.id };
    const loadedDetail = owned
      ? await window.deepwrite!.marketplace.myDetail(ref)
      : await window.deepwrite!.marketplace.detail(ref);
    let skills: MarketplaceSkillDetail[];
    let sections: DetailSkillSection[] = [];
    if (loadedDetail.contentType === "skill") {
      skills = [loadedDetail];
    } else if (loadedDetail.contentType === "library") {
      skills = loadedDetail.skills;
    } else {
      const memberDetails = await Promise.all(
        loadedDetail.items.map((member) => {
          const memberRef = {
            contentType: member.contentType,
            id: member.id
          };
          return owned
            ? window.deepwrite!.marketplace.myDetail(memberRef)
            : window.deepwrite!.marketplace.detail(memberRef);
        })
      );
      sections = memberDetails.flatMap((memberDetail) => {
        if (memberDetail.contentType === "skill") {
          return [
            {
              id: `skill:${memberDetail.id}`,
              title: memberDetail.title,
              kind: memberDetail.kind,
              skills: [memberDetail]
            }
          ];
        }
        if (memberDetail.contentType === "library") {
          return [
            {
              id: `library:${memberDetail.id}`,
              title: memberDetail.title,
              kind: memberDetail.kind,
              skills: memberDetail.skills
            }
          ];
        }
        return [];
      });
      skills = sections.flatMap((section) => section.skills);
    }
    detail.value = loadedDetail;
    detailSkills.value = skills;
    detailSkillSections.value = sections;
    selectedDetailSectionId.value = sections[0]?.id ?? "";
    selectedDetailSkillId.value =
      sections[0]?.skills[0]?.id ?? skills[0]?.id ?? "";
  } catch (error: unknown) {
    await refreshSessionAfterError();
    detailSummary.value = null;
    detailSkills.value = [];
    detailSkillSections.value = [];
    selectedDetailSectionId.value = "";
    selectedDetailSkillId.value = "";
    uiMessage.error(errorMessage(error, t("couldNotLoadContentDetails")));
  } finally {
    detailPending.value = false;
  }
}

function applyLikeLocally(
  ref: MarketplaceContentRef,
  liked: boolean,
  count: number
): void {
  for (const collection of [browseItems.value, mineItems.value]) {
    const item = collection.find(
      (candidate) =>
        candidate.id === ref.id && candidate.contentType === ref.contentType
    );
    if (item) {
      item.likedByMe = liked;
      item.likeCount = count;
    }
  }
  if (
    detailSummary.value?.id === ref.id &&
    detailSummary.value.contentType === ref.contentType
  ) {
    detailSummary.value.likedByMe = liked;
    detailSummary.value.likeCount = count;
  }
}

async function toggleLike(item: MarketplaceContentSummary): Promise<void> {
  if (!apiAvailable.value) return;
  const ref = { contentType: item.contentType, id: item.id };
  const previousLiked = item.likedByMe;
  const previousCount = item.likeCount;
  const nextLiked = !previousLiked;
  applyLikeLocally(
    ref,
    nextLiked,
    Math.max(0, previousCount + (nextLiked ? 1 : -1))
  );
  try {
    const result = await window.deepwrite!.marketplace.like({
      ...ref,
      liked: nextLiked
    });
    applyLikeLocally(ref, result.liked, result.likeCount);
  } catch (error: unknown) {
    applyLikeLocally(ref, previousLiked, previousCount);
    await refreshSessionAfterError();
    uiMessage.error(
      errorMessage(error, t("likeFailedThePreviousStateWasRestored"))
    );
  }
}

async function togglePublicationEnabled(
  item: MarketplaceContentSummary
): Promise<void> {
  if (!apiAvailable.value || item.status === "deleted") return;
  const key = `${item.contentType}:${item.id}`;
  if (enabledPendingKey.value) return;
  enabledPendingKey.value = key;
  try {
    const updated = await window.deepwrite!.marketplace.setEnabled({
      contentType: item.contentType,
      id: item.id,
      enabled: !item.enabled
    });
    const index = mineItems.value.findIndex(
      (candidate) =>
        candidate.contentType === updated.contentType &&
        candidate.id === updated.id
    );
    if (index >= 0) mineItems.value[index] = updated;
    browseItems.value = browseItems.value.filter(
      (candidate) =>
        candidate.contentType !== updated.contentType ||
        candidate.id !== updated.id
    );
    if (updated.enabled) {
      uiMessage.success(
        updated.status === "published"
          ? t("enabledThisContentWillAppearInTheMarketplace")
          : t("enabledThisContentWillAppearAfterReviewApproval")
      );
    } else {
      uiMessage.success(t("disabledThisContentWillNotAppearInTheMarketplace"));
    }
  } catch (error: unknown) {
    await refreshSessionAfterError();
    uiMessage.error(
      errorMessage(error, t("couldNotUpdateMarketplaceVisibility"))
    );
  } finally {
    enabledPendingKey.value = "";
  }
}

function deletedRetentionText(item: MarketplaceContentSummary): string {
  if (!item.purgeAt) return t("deletedTheServerRetainsItForAbout10Days");
  return t("retainedUntilValue", {
    arg0: new Date(item.purgeAt).toLocaleString()
  });
}

async function prepareInstall(item: MarketplaceContentSummary): Promise<void> {
  if (!apiAvailable.value || installPending.value) return;
  installPending.value = true;
  try {
    const preview = await window.deepwrite!.marketplace.previewInstall({
      contentType: item.contentType,
      id: item.id
    });
    installPreview.value = preview;
    installTargetLibraryId.value = "";
  } catch (error: unknown) {
    uiMessage.error(errorMessage(error, t("couldNotLoadInstallationPreview")));
  } finally {
    installPending.value = false;
  }
}

async function confirmInstall(): Promise<void> {
  if (!installPreview.value || !apiAvailable.value || installPending.value)
    return;
  if (
    installPreview.value.ref.contentType === "skill" &&
    !installTargetLibraryId.value
  ) {
    uiMessage.warning(t("selectALocalSkillLibraryToInstallInto"));
    return;
  }
  installPending.value = true;
  try {
    const targetLibrary = props.catalogSnapshot?.skills.find(
      ({ id }) => id === installTargetLibraryId.value
    );
    const result = await window.deepwrite!.marketplace.install({
      ref: {
        contentType: installPreview.value.ref.contentType,
        id: installPreview.value.ref.id
      },
      ...(installPreview.value.ref.contentType === "skill"
        ? { targetLibraryId: installTargetLibraryId.value }
        : {}),
      libraryTypesByKind: {
        // Keep the remote metadata so exported content remains readable by older clients.
        ...Object.fromEntries(
          installPreview.value.buckets.map((bucket) => [
            bucket.kind,
            bucket.libraryType
          ])
        ),
        ...(targetLibrary
          ? { [targetLibrary.skillKind]: targetLibrary.skillType }
          : {})
      }
    });
    if (result.alreadyInstalled) {
      uiMessage.info(t("thisVersionIsAlreadyInstalled"));
    } else if (!result.downloadCounted) {
      uiMessage.warning(
        t("skillsWereInstalledLocallyButTheRemoteDownloadCount")
      );
    } else {
      uiMessage.success(
        t("installedValue", {
          arg0: result.title
        })
      );
    }
    installPreview.value = null;
    emit("refreshCatalog");
  } catch (error: unknown) {
    uiMessage.error(errorMessage(error, t("couldNotInstallSkillContent")));
  } finally {
    installPending.value = false;
  }
}

function resetPublishForm(
  type: MarketplaceContentType = publishType.value
): void {
  editingRef.value = null;
  publishSourceLoadToken += 1;
  publishSourceLoading.value = false;
  publishType.value = type;
  publishSourceId.value = "";
  publishTitle.value = "";
  publishOverview.value = "";
  publishKind.value = "other";
  publishLibraryType.value = "short";
  publishStageId.value = "draft";
  publishBody.value = "";
  publishEntries.value = [];
  publishGroupLibraries.value = [];
  publishGroupItems.value = [];
  publishGroupItemLabels.value = {};
}

function changePublishType(value: PopupSelectValue): void {
  resetPublishForm(value as MarketplaceContentType);
}

async function applyPublishSource(value: PopupSelectValue): Promise<void> {
  publishSourceId.value = String(value);
  const token = ++publishSourceLoadToken;
  const reader = catalogDocumentReader();
  if (!reader) {
    uiMessage.warning(t("thisEnvironmentCannotReadLocalSkillContent"));
    return;
  }
  publishSourceLoading.value = true;
  try {
    if (publishType.value === "skill") {
      const [libraryId, entryId] = publishSourceId.value.split("\u0000");
      const library = props.catalogSnapshot?.skills.find(
        ({ id }) => id === libraryId
      );
      const entry = library?.entries.find(({ id }) => id === entryId);
      if (!library || !entry || !libraryId || !entryId) return;
      publishTitle.value = entry.title;
      publishKind.value = library.skillKind;
      publishLibraryType.value = library.skillType;
      publishStageId.value = entry.stageId;
      const [overview, content] = await Promise.all([
        loadMarketplacePublishLibraryOverview(reader, library.id),
        loadMarketplacePublishSkillContent(reader, library.id, entry.id)
      ]);
      if (token !== publishSourceLoadToken) return;
      publishOverview.value = overview;
      publishBody.value = content;
      if (!content.trim()) {
        uiMessage.warning(
          formatMarketplacePublishEmptyContentMessage([entry.title])
        );
      }
      return;
    }
    if (publishType.value === "group") {
      const group = props.catalogSnapshot?.skillGroups.find(
        ({ id }) => id === publishSourceId.value
      );
      if (!group) return;
      publishTitle.value = group.title;
      publishOverview.value = "";
      const libraries = await Promise.all(
        localLibrariesForGroup(group.id).map((library) =>
          loadMarketplacePublishLibraryContent(
            reader,
            skillLibraryPublishSource(library)
          )
        )
      );
      if (token !== publishSourceLoadToken) return;
      const emptyTitles = libraries.flatMap((library) => library.emptyTitles);
      publishGroupLibraries.value = libraries.map(
        ({ title, overview, kind, libraryType, entries }) => ({
          title,
          overview,
          kind,
          libraryType,
          entries
        })
      );
      if (emptyTitles.length > 0) {
        uiMessage.warning(
          formatMarketplacePublishEmptyContentMessage(emptyTitles)
        );
      }
      return;
    }
    const library = props.catalogSnapshot?.skills.find(
      ({ id }) => id === publishSourceId.value
    );
    if (!library) return;
    publishTitle.value = library.title;
    publishKind.value = library.skillKind;
    publishLibraryType.value = library.skillType;
    const loaded = await loadMarketplacePublishLibraryContent(
      reader,
      skillLibraryPublishSource(library)
    );
    if (token !== publishSourceLoadToken) return;
    publishOverview.value = loaded.overview;
    publishEntries.value = loaded.entries;
    if (loaded.emptyTitles.length > 0) {
      uiMessage.warning(
        formatMarketplacePublishEmptyContentMessage(loaded.emptyTitles)
      );
    }
  } catch (error: unknown) {
    if (token !== publishSourceLoadToken) return;
    uiMessage.error(errorMessage(error, t("couldNotReadLocalSkillContent")));
  } finally {
    if (token === publishSourceLoadToken) {
      publishSourceLoading.value = false;
    }
  }
}

function groupItemLabel(ref: MarketplaceContentRef): string {
  return publishGroupItemLabels.value[`${ref.contentType}:${ref.id}`] ?? ref.id;
}

function buildPublishInput(): MarketplacePublishInput | null {
  const title = publishTitle.value.trim();
  if (!title) {
    uiMessage.warning(t("enterAPublicationTitle"));
    return null;
  }
  if (publishType.value === "skill") {
    if (!publishBody.value.trim()) {
      uiMessage.warning(t("selectAndConfirmTheLocalSkillContentToPublish"));
      return null;
    }
    return {
      contentType: "skill",
      title,
      overview: publishOverview.value.trim(),
      kind: publishKind.value,
      libraryType: publishLibraryType.value,
      stageId: publishStageId.value,
      content: publishBody.value
    };
  }
  if (publishType.value === "library") {
    if (publishEntries.value.length === 0) {
      uiMessage.warning(t("selectALocalLibraryThatIsNotBuiltIn"));
      return null;
    }
    const emptyTitles = publishEntries.value
      .filter((entry) => !entry.content.trim())
      .map((entry) => entry.title);
    if (emptyTitles.length > 0) {
      uiMessage.warning(
        formatMarketplacePublishEmptyContentMessage(emptyTitles)
      );
      return null;
    }
    return {
      contentType: "library",
      title,
      overview: publishOverview.value.trim(),
      kind: publishKind.value,
      libraryType: publishLibraryType.value,
      entries: publishEntries.value.map(
        ({ stageId, title: entryTitle, content }) => ({
          stageId,
          title: entryTitle,
          content
        })
      )
    };
  }
  if (
    publishGroupLibraries.value.length === 0 &&
    publishGroupItems.value.length === 0
  ) {
    uiMessage.warning(t("selectALocalSkillGroupContainingLibrariesThatAre"));
    return null;
  }
  if (publishGroupLibraries.value.length > 0) {
    const emptyTitles = publishGroupLibraries.value.flatMap((library) =>
      library.entries
        .filter((entry) => !entry.content.trim())
        .map((entry) => entry.title)
    );
    if (emptyTitles.length > 0) {
      uiMessage.warning(
        formatMarketplacePublishEmptyContentMessage(emptyTitles)
      );
      return null;
    }
    if (
      publishGroupLibraries.value.some(
        (library) => library.entries.length === 0
      )
    ) {
      uiMessage.warning(t("aLibraryInThisGroupHasNoPublishableContent"));
      return null;
    }
    return {
      contentType: "group",
      title,
      overview: publishOverview.value.trim(),
      libraries: publishGroupLibraries.value.map((library) => ({
        title: library.title,
        overview: library.overview,
        kind: library.kind,
        libraryType: library.libraryType,
        entries: library.entries.map((entry) => ({ ...entry }))
      }))
    };
  }
  return {
    contentType: "group",
    title,
    overview: publishOverview.value.trim(),
    items: publishGroupItems.value.map(({ contentType: itemType, id }) => ({
      contentType: itemType,
      id
    }))
  };
}

async function hydrateLocalPublishContents(): Promise<boolean> {
  if (editingRef.value) return true;
  const reader = catalogDocumentReader();
  if (!reader) {
    uiMessage.warning(t("thisEnvironmentCannotReadLocalSkillContent"));
    return false;
  }
  if (publishType.value === "skill") {
    if (publishBody.value.trim()) return true;
    const [libraryId, entryId] = publishSourceId.value.split("\u0000");
    if (!libraryId || !entryId) {
      uiMessage.warning(t("selectAndConfirmTheLocalSkillContentToPublish"));
      return false;
    }
    publishBody.value = await loadMarketplacePublishSkillContent(
      reader,
      libraryId,
      entryId
    );
    if (!publishOverview.value.trim()) {
      publishOverview.value = await loadMarketplacePublishLibraryOverview(
        reader,
        libraryId
      );
    }
    return true;
  }
  if (publishType.value === "library") {
    const library = props.catalogSnapshot?.skills.find(
      ({ id }) => id === publishSourceId.value
    );
    if (!library) {
      uiMessage.warning(t("selectALocalLibraryThatIsNotBuiltIn"));
      return false;
    }
    const needsReload =
      publishEntries.value.length === 0 ||
      publishEntries.value.some((entry) => !entry.content.trim()) ||
      !publishOverview.value.trim();
    if (!needsReload) return true;
    const loaded = await loadMarketplacePublishLibraryContent(
      reader,
      skillLibraryPublishSource(library)
    );
    publishOverview.value = loaded.overview;
    publishEntries.value = loaded.entries;
    if (loaded.emptyTitles.length > 0) {
      uiMessage.warning(
        formatMarketplacePublishEmptyContentMessage(loaded.emptyTitles)
      );
      return false;
    }
    return true;
  }
  if (publishGroupItems.value.length > 0) return true;
  const libraries = localLibrariesForGroup(publishSourceId.value);
  if (libraries.length === 0) {
    uiMessage.warning(t("selectALocalSkillGroupContainingLibrariesThatAre"));
    return false;
  }
  const loaded = await Promise.all(
    libraries.map((library) =>
      loadMarketplacePublishLibraryContent(
        reader,
        skillLibraryPublishSource(library)
      )
    )
  );
  const emptyTitles = loaded.flatMap((library) => library.emptyTitles);
  publishGroupLibraries.value = loaded.map(
    ({ title, overview, kind, libraryType, entries }) => ({
      title,
      overview,
      kind,
      libraryType,
      entries
    })
  );
  if (emptyTitles.length > 0) {
    uiMessage.warning(formatMarketplacePublishEmptyContentMessage(emptyTitles));
    return false;
  }
  return true;
}

async function submitPublish(): Promise<void> {
  if (
    !apiAvailable.value ||
    publishPending.value ||
    publishSourceLoading.value
  ) {
    return;
  }
  publishPending.value = true;
  try {
    const hydrated = await hydrateLocalPublishContents();
    if (!hydrated) return;
    const input = buildPublishInput();
    if (!input) return;
    if (editingRef.value) {
      await window.deepwrite!.marketplace.update({
        id: editingRef.value.id,
        content: input
      });
      uiMessage.success(t("changesSubmittedTheContentIsPendingReviewAgain"));
    } else {
      const published = await window.deepwrite!.marketplace.publish(input);
      if (!published.enabled) {
        uiMessage.warning(t("contentSubmittedButEnableFailed"));
      } else {
        uiMessage.success(
          published.status === "published"
            ? t("enabledThisContentWillAppearInTheMarketplace")
            : t("contentSubmittedForReview")
        );
      }
    }
    resetPublishForm(input.contentType);
    await loadMine(1);
    pageTab.value = "mine";
  } catch (error: unknown) {
    await refreshSessionAfterError();
    uiMessage.error(errorMessage(error, t("couldNotSubmitContent")));
  } finally {
    publishPending.value = false;
  }
}

async function editPublished(item: MarketplaceContentSummary): Promise<void> {
  if (!apiAvailable.value) return;
  try {
    const owned = await window.deepwrite!.marketplace.myDetail({
      contentType: item.contentType,
      id: item.id
    });
    resetPublishForm(owned.contentType);
    editingRef.value = { contentType: owned.contentType, id: owned.id };
    publishTitle.value = owned.title;
    publishOverview.value = owned.overview;
    if (owned.contentType === "skill") {
      publishKind.value = owned.kind;
      publishLibraryType.value = owned.libraryType;
      publishStageId.value = owned.stageId;
      publishBody.value = owned.content;
    } else if (owned.contentType === "library") {
      publishKind.value = owned.kind;
      publishLibraryType.value = owned.libraryType;
      publishEntries.value = owned.skills.map((skill) => ({
        stageId: skill.stageId,
        title: skill.title,
        content: skill.content
      }));
    } else {
      publishGroupItems.value = owned.items.map(
        ({ contentType: type, id }) => ({
          contentType: type,
          id
        })
      );
      publishGroupItemLabels.value = Object.fromEntries(
        owned.items.map(({ contentType: type, id, title }) => [
          `${type}:${id}`,
          title
        ])
      );
    }
    detail.value = null;
    pageTab.value = "publish";
  } catch (error: unknown) {
    await refreshSessionAfterError();
    uiMessage.error(errorMessage(error, t("couldNotLoadContentForEditing")));
  }
}

async function confirmDelete(): Promise<void> {
  if (!deleteTarget.value || !apiAvailable.value || deletePending.value) return;
  deletePending.value = true;
  try {
    await window.deepwrite!.marketplace.delete({
      contentType: deleteTarget.value.contentType,
      id: deleteTarget.value.id
    });
    uiMessage.success(t("contentMarkedAsDeletedTheServerWillRetainIt"));
    deleteTarget.value = null;
    detail.value = null;
    await loadMine();
  } catch (error: unknown) {
    await refreshSessionAfterError();
    uiMessage.error(errorMessage(error, t("couldNotDeletePublishedContent")));
  } finally {
    deletePending.value = false;
  }
}

watch(
  () => props.active,
  (active) => {
    if (active && session.value === null) void restoreSession();
  }
);

onMounted(() => {
  if (props.active) void restoreSession();
});
</script>

<template>
  <section class="marketplace-page" :aria-label="t('skillMarketplace')">
    <header class="marketplace-header">
      <div>
        <span class="marketplace-eyebrow">{{ t("moreFeatures") }}</span>
        <h1>{{ t("skillMarketplace") }}</h1>
        <p>
          {{ t("discoverInstallAndPublishDeepWriteWritingSkills") }}
        </p>
      </div>
      <div v-if="authenticated" class="marketplace-account">
        <span>{{ session?.user?.displayName }}</span>
        <MarketplaceBindEmail
          v-if="session"
          :key="session.user?.id ?? 'account'"
          :session="session"
          @updated="updateSession"
        />
        <button type="button" class="secondary-button" @click="logout">
          {{ t("signOut") }}
        </button>
      </div>
    </header>

    <div v-if="insecureTransport" class="insecure-warning" role="note">
      <AppIcon name="globe" :size="17" />
      <div>
        <strong>{{ t("unencryptedConnection") }}</strong>
        <span>{{
          t("theMarketplaceCurrentlyUsesHTTPUsernamesPasswordsAndSession")
        }}</span>
      </div>
    </div>

    <div v-if="!apiAvailable" class="marketplace-empty-state">
      <strong>{{ t("desktopCapabilitiesAreUnavailable") }}</strong>
      <span>{{ t("openTheSkillMarketplaceInTheDeepWriteDesktopApp") }}</span>
    </div>

    <div v-else-if="session === null" class="marketplace-empty-state">
      <span>{{ t("restoringSignIn") }}</span>
    </div>

    <MarketplaceAuthForm
      v-else-if="!authenticated"
      @authenticated="authenticatedSession"
    />

    <template v-else>
      <nav class="marketplace-tabs" :aria-label="t('skillMarketplacePage')">
        <button
          type="button"
          :class="{ active: pageTab === 'browse' }"
          @click="selectTab('browse')"
        >
          {{ t("marketplace") }}
        </button>
        <button
          type="button"
          :class="{ active: pageTab === 'mine' }"
          @click="selectTab('mine')"
        >
          {{ t("myPublications") }}
        </button>
        <button
          type="button"
          :class="{ active: pageTab === 'publish' }"
          @click="selectTab('publish')"
        >
          {{ t("publishContent") }}
        </button>
      </nav>

      <section v-if="pageTab === 'browse'" class="marketplace-content">
        <form class="marketplace-filters" @submit.prevent="loadBrowse(1)">
          <label class="search-field">
            <AppIcon name="search" :size="16" />
            <input
              v-model="query"
              :placeholder="t('searchNamesDescriptionsOrAuthors')"
              maxlength="256"
            />
          </label>
          <PopupSelect
            v-model="contentType"
            :options="contentTypeOptions"
            :accessible-label="t('contentType')"
            variant="compact"
          />
          <PopupSelect
            v-model="kind"
            :options="kindOptions"
            :accessible-label="t('skillCategory')"
            variant="compact"
          />
          <PopupSelect
            v-model="sort"
            :options="sortOptions"
            :accessible-label="t('sortBy')"
            variant="compact"
          />
          <button
            class="secondary-button compact"
            type="button"
            :disabled="loading"
            @click="loadBrowse()"
          >
            {{ loading ? t("refreshing") : t("refresh") }}
          </button>
          <button
            class="primary-button compact"
            type="submit"
            :disabled="loading"
          >
            {{ t("search") }}
          </button>
        </form>

        <div v-if="loading" class="marketplace-empty-state">
          <span>{{ t("loadingSkills") }}</span>
        </div>
        <div
          v-else-if="browseItems.length === 0"
          class="marketplace-empty-state"
        >
          <strong>{{ t("noMatchingContent") }}</strong>
          <span>{{ t("tryDifferentKeywordsOrFilters") }}</span>
        </div>
        <div v-else class="content-grid">
          <article
            v-for="item in browseItems"
            :key="`${item.contentType}:${item.id}`"
            class="content-card"
          >
            <div class="content-card-heading">
              <span class="type-badge">{{
                CONTENT_TYPE_LABELS[item.contentType]
              }}</span>
              <span v-if="item.kind" class="meta-badge">{{
                KIND_LABELS[item.kind]
              }}</span>
            </div>
            <button class="card-title" type="button" @click="openDetail(item)">
              {{ item.title }}
            </button>
            <p>
              {{ item.overview || t("theAuthorHasNotProvidedADescription") }}
            </p>
            <div class="card-meta">
              <span>{{ item.ownerName || item.ownerUsername }}</span
              ><span>v{{ item.version }}</span>
            </div>
            <div class="card-actions">
              <button
                type="button"
                class="text-button"
                @click="toggleLike(item)"
              >
                <span :class="{ liked: item.likedByMe }">♥</span>
                {{ item.likeCount }}
              </button>
              <span>{{
                t("downloadsMessage", {
                  arg0: item.downloadCount ?? ""
                })
              }}</span>
              <button
                type="button"
                class="secondary-button"
                @click="openDetail(item)"
              >
                {{ t("details") }}
              </button>
              <button
                type="button"
                class="primary-button compact"
                :disabled="installPending"
                @click="prepareInstall(item)"
              >
                {{ t("install") }}
              </button>
            </div>
          </article>
        </div>
        <nav
          v-if="browseTotal > 0"
          class="marketplace-pagination"
          :aria-label="t('marketplacePagination')"
        >
          <span>{{
            t("totalPerPageMessage", {
              arg0: browseTotal ?? "",
              arg1: PAGE_SIZE ?? ""
            })
          }}</span>
          <div>
            <button
              type="button"
              class="secondary-button compact"
              :disabled="loading || browsePage <= 1"
              @click="changeBrowsePage(1)"
            >
              {{ t("first") }}
            </button>
            <button
              type="button"
              class="secondary-button compact"
              :disabled="loading || browsePage <= 1"
              @click="changeBrowsePage(browsePage - 1)"
            >
              {{ t("previous") }}
            </button>
            <strong>{{
              t("pageMessage", {
                arg0: browsePage ?? "",
                arg1: browseDisplayTotalPages ?? ""
              })
            }}</strong>
            <button
              type="button"
              class="secondary-button compact"
              :disabled="loading || browsePage >= browseDisplayTotalPages"
              @click="changeBrowsePage(browsePage + 1)"
            >
              {{ t("next") }}
            </button>
            <button
              type="button"
              class="secondary-button compact"
              :disabled="loading || browsePage >= browseDisplayTotalPages"
              @click="changeBrowsePage(browseDisplayTotalPages)"
            >
              {{ t("last") }}
            </button>
          </div>
        </nav>
      </section>

      <section v-else-if="pageTab === 'mine'" class="marketplace-content">
        <div class="section-heading">
          <div>
            <h2>{{ t("myPublications") }}</h2>
            <p>
              {{
                t("onlyEnabledApprovedContentAppearsInTheMarketplaceDeleted")
              }}
            </p>
          </div>
          <button
            class="secondary-button"
            type="button"
            :disabled="mineLoading"
            @click="loadMine()"
          >
            {{ mineLoading ? t("refreshing") : t("refresh") }}
          </button>
        </div>
        <div
          v-if="mineLoading && mineItems.length === 0"
          class="marketplace-empty-state"
        >
          <span>{{ t("loadingPublications") }}</span>
        </div>
        <div
          v-else-if="visibleMineItems.length === 0"
          class="marketplace-empty-state"
        >
          <strong>{{ t("noPublicationsYet") }}</strong>
          <button
            type="button"
            class="primary-button compact"
            @click="selectTab('publish')"
          >
            {{ t("publishYourFirstSkill") }}
          </button>
        </div>
        <div v-else class="mine-list">
          <article
            v-for="item in visibleMineItems"
            :key="`${item.contentType}:${item.id}`"
            class="mine-row"
          >
            <button
              class="mine-main"
              type="button"
              :disabled="item.status === 'deleted'"
              @click="openDetail(item, true)"
            >
              <span class="type-badge">{{
                CONTENT_TYPE_LABELS[item.contentType]
              }}</span>
              <span>
                <strong>{{ item.title }}</strong>
                <small v-if="item.status === 'deleted'">{{
                  deletedRetentionText(item)
                }}</small>
                <small v-else>{{
                  t("vUpdatedMessage", {
                    arg0: item.version ?? "",
                    arg1: (item.enabled ? t("visible") : t("hidden")) ?? "",
                    arg2: new Date(item.updatedAt).toLocaleString() ?? ""
                  })
                }}</small>
              </span>
            </button>
            <span class="status-badge" :data-status="item.status">{{
              STATUS_LABELS[item.status] ?? item.status
            }}</span>
            <div v-if="item.status !== 'deleted'" class="mine-actions">
              <button
                type="button"
                role="switch"
                :aria-checked="item.enabled"
                :class="item.enabled ? 'secondary-button' : 'primary-button'"
                :disabled="Boolean(enabledPendingKey)"
                @click="togglePublicationEnabled(item)"
              >
                {{
                  enabledPendingKey === `${item.contentType}:${item.id}`
                    ? t("updating")
                    : item.enabled
                      ? t("disable")
                      : t("enable")
                }}
              </button>
              <button
                class="secondary-button"
                type="button"
                @click="editPublished(item)"
              >
                {{ t("edit") }}
              </button>
              <button
                class="danger-outline-button"
                type="button"
                @click="deleteTarget = item"
              >
                {{ t("delete") }}
              </button>
            </div>
          </article>
        </div>
        <nav
          v-if="mineTotal > 0"
          class="marketplace-pagination"
          :aria-label="t('myPublicationsPagination')"
        >
          <span>{{
            t("totalPerPageMessage", {
              arg0: mineTotal ?? "",
              arg1: PAGE_SIZE ?? ""
            })
          }}</span>
          <div>
            <button
              type="button"
              class="secondary-button compact"
              :disabled="mineLoading || minePage <= 1"
              @click="changeMinePage(1)"
            >
              {{ t("first") }}
            </button>
            <button
              type="button"
              class="secondary-button compact"
              :disabled="mineLoading || minePage <= 1"
              @click="changeMinePage(minePage - 1)"
            >
              {{ t("previous") }}
            </button>
            <strong>{{
              t("pageMessage", {
                arg0: minePage ?? "",
                arg1: mineDisplayTotalPages ?? ""
              })
            }}</strong>
            <button
              type="button"
              class="secondary-button compact"
              :disabled="mineLoading || minePage >= mineDisplayTotalPages"
              @click="changeMinePage(minePage + 1)"
            >
              {{ t("next") }}
            </button>
            <button
              type="button"
              class="secondary-button compact"
              :disabled="mineLoading || minePage >= mineDisplayTotalPages"
              @click="changeMinePage(mineDisplayTotalPages)"
            >
              {{ t("last") }}
            </button>
          </div>
        </nav>
      </section>

      <section v-else class="marketplace-content publish-content">
        <div class="section-heading">
          <div>
            <h2>
              {{ editingRef ? t("editPublication") : t("publishContent") }}
            </h2>
            <p>
              {{ t("newAndEditedContentEntersPublicVisibilityWithPending") }}
            </p>
          </div>
          <button
            v-if="editingRef"
            class="secondary-button"
            type="button"
            @click="resetPublishForm()"
          >
            {{ t("cancelEditing") }}
          </button>
        </div>
        <form class="publish-form" @submit.prevent="submitPublish">
          <label>
            <span>{{ t("contentType") }}</span>
            <PopupSelect
              :model-value="publishType"
              :options="publishTypeOptions"
              :accessible-label="t('publicationType')"
              :disabled="Boolean(editingRef)"
              @update:model-value="changePublishType"
            />
          </label>

          <label v-if="!editingRef">
            <span>{{
              publishType === "skill"
                ? t("localSkill")
                : publishType === "library"
                  ? t("localSkillLibrary")
                  : t("localSkillGroup")
            }}</span>
            <PopupSelect
              :model-value="publishSourceId"
              :options="currentSourceOptions"
              :accessible-label="
                publishType === 'skill'
                  ? t('selectLocalSkill')
                  : publishType === 'library'
                    ? t('selectLocalSkillLibrary')
                    : t('selectLocalSkillGroup')
              "
              :placeholder="t('selectLocalContentThatIsNotBuiltIn')"
              @update:model-value="applyPublishSource"
            />
          </label>

          <label>
            <span>{{ t("title") }}</span>
            <input v-model="publishTitle" maxlength="256" />
          </label>
          <label class="full-field">
            <span>{{ t("description") }}</span>
            <textarea
              v-model="publishOverview"
              rows="3"
              :maxlength="MARKETPLACE_CONTENT_MAX_CHARACTERS"
            />
          </label>

          <template v-if="publishType === 'skill'">
            <div class="publish-metadata">
              <span>{{ KIND_LABELS[publishKind] }}</span>
              <span>{{ publishStageId }}</span>
            </div>
            <label class="full-field">
              <span>{{ t("skillContent") }}</span>
              <textarea
                v-model="publishBody"
                rows="12"
                :maxlength="MARKETPLACE_CONTENT_MAX_CHARACTERS"
              />
            </label>
          </template>

          <div
            v-else-if="publishType === 'library'"
            class="full-field publish-entry-list"
          >
            <span>{{ t("skillEntriesLocalOrder") }}</span>
            <article v-for="(entry, index) in publishEntries" :key="index">
              <strong>{{ index + 1 }}. {{ entry.title }}</strong>
              <textarea
                v-model="entry.content"
                rows="5"
                :maxlength="MARKETPLACE_CONTENT_MAX_CHARACTERS"
              />
            </article>
          </div>

          <div v-else class="full-field group-publisher">
            <span>{{
              editingRef
                ? t("currentRemoteGroupMembers")
                : t("librariesInTheLocalGroupPublishedInCategoryOrder")
            }}</span>
            <div
              v-if="!editingRef && publishGroupLibraries.length === 0"
              class="stable-help"
            >
              {{ t("selectACompleteExistingSkillGroupUnderMySkill") }}
            </div>
            <ol v-if="publishGroupLibraries.length" class="group-order-list">
              <li
                v-for="(library, index) in publishGroupLibraries"
                :key="`${library.kind}:${library.title}`"
              >
                <span>{{ index + 1 }}. {{ library.title }}</span>
                <small>{{
                  t("skillsMessage", {
                    arg0: KIND_LABELS[library.kind] ?? "",
                    arg2: library.entries.length ?? ""
                  })
                }}</small>
              </li>
            </ol>
            <ol v-else-if="publishGroupItems.length" class="group-order-list">
              <li
                v-for="item in publishGroupItems"
                :key="`${item.contentType}:${item.id}`"
              >
                <span>{{ groupItemLabel(item) }}</span>
                <small>{{ CONTENT_TYPE_LABELS[item.contentType] }}</small>
              </li>
            </ol>
          </div>

          <div class="publish-actions full-field">
            <span>{{
              t("fileUploadsAreNotAvailableInThisDesktopInterface")
            }}</span>
            <button
              class="primary-button"
              type="submit"
              :disabled="publishPending || publishSourceLoading"
            >
              {{
                publishPending
                  ? t("submitting")
                  : publishSourceLoading
                    ? t("readingContent")
                    : editingRef
                      ? t("saveAndResubmitForReview")
                      : t("submitForReview")
              }}
            </button>
          </div>
        </form>
      </section>
    </template>

    <Teleport to="body">
      <div
        v-if="detail"
        class="marketplace-modal-backdrop"
        @mousedown.self="detail = null"
      >
        <section
          class="marketplace-modal detail-modal"
          role="dialog"
          aria-modal="true"
          :aria-label="t('skillDetails')"
        >
          <header>
            <div>
              <span
                >{{ CONTENT_TYPE_LABELS[detail.contentType] }} · v{{
                  detail.version
                }}</span
              >
              <h2>{{ detail.title }}</h2>
            </div>
            <button
              type="button"
              :aria-label="t('closeDetails')"
              @click="detail = null"
            >
              ×
            </button>
          </header>
          <div class="modal-scroll">
            <p class="detail-overview">
              {{ detail.overview || t("theAuthorHasNotProvidedADescription") }}
            </p>
            <div
              v-if="
                detail.contentType === 'group' && detailSkillSections.length
              "
              class="detail-category-tabs"
              role="tablist"
              :aria-label="t('selectSkillGroupCategory')"
            >
              <button
                v-for="section in detailSkillSections"
                :key="section.id"
                type="button"
                role="tab"
                :aria-selected="selectedDetailSection?.id === section.id"
                :class="{ active: selectedDetailSection?.id === section.id }"
                @click="selectDetailSection(section)"
              >
                <span class="detail-category-kind">{{
                  KIND_LABELS[section.kind]
                }}</span>
                <span class="detail-category-label">{{ section.title }}</span>
              </button>
            </div>
            <div
              v-if="
                detail.contentType !== 'skill' && visibleDetailSkills.length
              "
              class="detail-skill-tabs"
              role="tablist"
              :aria-label="t('selectASkillToView')"
            >
              <button
                v-for="skill in visibleDetailSkills"
                :id="`detail-skill-tab-${skill.id}`"
                :key="skill.id"
                type="button"
                role="tab"
                :aria-selected="selectedDetailSkill?.id === skill.id"
                :aria-controls="`detail-skill-panel-${skill.id}`"
                :class="{ active: selectedDetailSkill?.id === skill.id }"
                @click="selectedDetailSkillId = skill.id"
              >
                {{ skill.title }}
              </button>
            </div>
            <article
              v-if="selectedDetailSkill"
              :id="`detail-skill-panel-${selectedDetailSkill.id}`"
              class="detail-markdown"
              role="tabpanel"
              :aria-labelledby="
                detail.contentType === 'skill'
                  ? undefined
                  : `detail-skill-tab-${selectedDetailSkill.id}`
              "
            >
              <h3>{{ selectedDetailSkill.title }}</h3>
              <MarkdownContent :content="selectedDetailSkill.content" />
            </article>
            <p v-else class="detail-empty">
              {{ t("noSkillsAvailableToViewInThisContent") }}
            </p>
          </div>
          <footer>
            <button
              v-if="detailSummary"
              type="button"
              class="text-button"
              @click="toggleLike(detailSummary)"
            >
              ♥ {{ detailSummary.likeCount }}
            </button>
            <button
              type="button"
              class="secondary-button"
              @click="detail = null"
            >
              {{ t("close") }}
            </button>
            <button
              v-if="detailSummary?.status === 'published'"
              type="button"
              class="primary-button"
              @click="
                prepareInstall(detailSummary);
                detail = null;
              "
            >
              {{ t("install") }}
            </button>
          </footer>
        </section>
      </div>

      <div
        v-if="installPreview"
        class="marketplace-modal-backdrop"
        @mousedown.self="!installPending && (installPreview = null)"
      >
        <section
          class="marketplace-modal install-modal"
          role="dialog"
          aria-modal="true"
          :aria-label="t('installSkillContent')"
        >
          <header>
            <div>
              <span>{{ t("installationPreview") }}</span>
              <h2>{{ installPreview.title }}</h2>
            </div>
            <button
              type="button"
              :aria-label="t('close')"
              @click="installPreview = null"
            >
              ×
            </button>
          </header>
          <div class="modal-scroll">
            <p v-if="installPreview.alreadyInstalled" class="stable-help">
              {{
                t("versionIsInstalledNewRemoteVersionsAreMessage", {
                  arg0: installPreview.version ?? ""
                })
              }}
            </p>
            <p v-if="installPreview.orderNotice" class="stable-help">
              {{ installPreview.orderNotice }}
            </p>
            <label v-if="installPreview.ref.contentType === 'skill'">
              <span>{{ t("installIntoSkillLibrary") }}</span>
              <PopupSelect
                v-model="installTargetLibraryId"
                :options="installTargetLibraryOptions"
                :accessible-label="t('selectTargetLibraryForTheSkill')"
                :placeholder="t('selectASkillLibrary')"
                :disabled="installTargetLibraryOptions.length === 0"
                :menu-z-index="2200"
              />
            </label>
            <p
              v-if="
                installPreview.ref.contentType === 'skill' &&
                installTargetLibraryOptions.length === 0
              "
              class="stable-help"
            >
              {{ t("noWritableSkillLibrariesCreateOneInTheSidebar") }}
            </p>
            <article
              v-for="bucket in installPreview.buckets"
              :key="bucket.kind"
              class="install-bucket"
            >
              <div>
                <strong>{{ KIND_LABELS[bucket.kind] }}</strong
                ><span>{{
                  t("skillsMessageDetail", {
                    arg0: bucket.entries.length ?? ""
                  })
                }}</span>
              </div>
              <ol>
                <li
                  v-for="entry in bucket.entries"
                  :key="entry.marketplaceSkillId"
                >
                  {{ entry.title }}
                </li>
              </ol>
            </article>
          </div>
          <footer>
            <button
              class="secondary-button"
              type="button"
              :disabled="installPending"
              @click="installPreview = null"
            >
              {{ t("cancel") }}</button
            ><button
              class="primary-button"
              type="button"
              :disabled="
                installPending ||
                installPreview.alreadyInstalled ||
                (installPreview.ref.contentType === 'skill' &&
                  !installTargetLibraryId)
              "
              @click="confirmInstall"
            >
              {{
                installPending
                  ? t("installing")
                  : installPreview.alreadyInstalled
                    ? t("installed")
                    : t("installLabel")
              }}
            </button>
          </footer>
        </section>
      </div>

      <div
        v-if="deleteTarget"
        class="marketplace-modal-backdrop"
        @mousedown.self="!deletePending && (deleteTarget = null)"
      >
        <section
          class="marketplace-modal delete-modal"
          role="dialog"
          aria-modal="true"
          :aria-label="t('deleteRemotePublication')"
        >
          <header>
            <div>
              <span>{{ t("destructiveAction") }}</span>
              <h2>
                {{
                  t("deleteMessageDetail", {
                    arg0: deleteTarget.title ?? ""
                  })
                }}
              </h2>
            </div>
          </header>
          <p>
            {{ t("thisImmediatelyHidesTheContentFromTheMarketplaceAnd") }}
          </p>
          <footer>
            <button
              class="secondary-button"
              type="button"
              :disabled="deletePending"
              @click="deleteTarget = null"
            >
              {{ t("cancel") }}</button
            ><button
              class="danger-button"
              type="button"
              :disabled="deletePending"
              @click="confirmDelete"
            >
              {{ deletePending ? t("deleting") : t("deleteMessage") }}
            </button>
          </footer>
        </section>
      </div>
    </Teleport>
  </section>
</template>

<style scoped>
.marketplace-page {
  min-width: 0;
  height: 100%;
  overflow: auto;
  padding: 30px clamp(22px, 4vw, 54px) 48px;
  color: var(--text-primary);
  background: var(--surface-main);
}
.marketplace-header,
.section-heading,
.marketplace-account,
.content-card-heading,
.card-meta,
.card-actions,
.publish-actions,
.install-bucket > div {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.marketplace-header h1,
.section-heading h2 {
  margin: 3px 0 5px;
  font-size: 25px;
}
.marketplace-header p,
.section-heading p {
  margin: 0;
  color: var(--text-secondary);
}
.marketplace-eyebrow {
  color: var(--text-tertiary);
  font-size: 12px;
  letter-spacing: 0.08em;
}
.marketplace-account {
  align-self: flex-start;
  padding-top: 8px;
}
.insecure-warning {
  display: flex;
  gap: 11px;
  margin: 20px 0;
  padding: 13px 15px;
  border: 1px solid color-mix(in srgb, var(--danger) 42%, var(--theme-line));
  border-radius: 12px;
  color: color-mix(in srgb, var(--danger) 78%, var(--text-primary));
  background: color-mix(in srgb, var(--danger) 9%, var(--surface-raised));
}
.insecure-warning div {
  display: grid;
  gap: 3px;
}
.insecure-warning span {
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.55;
}
.marketplace-tabs {
  display: flex;
  border-bottom: 1px solid var(--theme-line-soft);
}
.marketplace-tabs button {
  flex: 1;
  border: 0;
  border-bottom: 2px solid transparent;
  padding: 13px 18px;
  color: var(--text-secondary);
  background: transparent;
  cursor: pointer;
}
.marketplace-tabs button.active {
  color: var(--text-primary);
  border-bottom-color: var(--accent);
  background: var(--surface-selected);
}
label {
  display: grid;
  gap: 7px;
  color: var(--text-secondary);
  font-size: 12px;
}
input,
textarea {
  box-sizing: border-box;
  width: 100%;
  border: 1px solid var(--theme-line);
  border-radius: 9px;
  padding: 10px 11px;
  color: var(--text-primary);
  background: var(--surface-main);
  font: inherit;
  outline: none;
  resize: vertical;
}
input:focus,
textarea:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-soft);
}
.publish-actions > span {
  color: var(--text-tertiary);
  line-height: 1.5;
}
.marketplace-tabs {
  margin-top: 20px;
  border: 1px solid var(--theme-line);
  border-radius: 12px 12px 0 0;
  background: var(--surface-raised);
}
.marketplace-content {
  border: 1px solid var(--theme-line);
  border-top: 0;
  border-radius: 0 0 14px 14px;
  padding: 20px;
  background: var(--surface-raised);
}
.marketplace-filters {
  display: grid;
  grid-template-columns:
    minmax(210px, 1fr) repeat(3, minmax(125px, auto))
    auto auto;
  gap: 9px;
  margin-bottom: 18px;
}
.search-field {
  position: relative;
  display: flex;
  align-items: center;
}
.search-field svg {
  position: absolute;
  left: 11px;
  color: var(--text-tertiary);
}
.search-field input {
  padding-left: 34px;
}
.content-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 13px;
}
.marketplace-pagination {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  margin-top: 18px;
  padding-top: 16px;
  border-top: 1px solid var(--theme-line-soft);
  color: var(--text-tertiary);
  font-size: 12px;
}
.marketplace-pagination > div {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 7px;
}
.marketplace-pagination strong {
  min-width: 88px;
  color: var(--text-secondary);
  font-weight: 600;
  text-align: center;
}
.content-card {
  display: grid;
  gap: 11px;
  min-width: 0;
  padding: 16px;
  border: 1px solid var(--theme-line-soft);
  border-radius: 12px;
  background: var(--surface-main);
}
.content-card:hover {
  border-color: var(--theme-line);
  background: var(--surface-hover);
}
.type-badge,
.meta-badge,
.status-badge,
.publish-metadata span {
  width: fit-content;
  padding: 3px 8px;
  border-radius: 999px;
  font-size: 11px;
  color: var(--text-secondary);
  background: var(--surface-muted);
}
.type-badge {
  color: var(--accent);
  background: var(--accent-soft);
}
.content-card-heading {
  justify-content: flex-start;
}
.card-title {
  border: 0;
  padding: 0;
  overflow: hidden;
  color: var(--text-primary);
  background: transparent;
  font-size: 16px;
  font-weight: 700;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
}
.content-card p {
  min-height: 3em;
  margin: 0;
  overflow: hidden;
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
.card-meta {
  color: var(--text-tertiary);
  font-size: 11px;
}
.card-actions {
  justify-content: flex-start;
  color: var(--text-tertiary);
  font-size: 12px;
}
.card-actions .secondary-button {
  margin-left: auto;
}
.liked {
  color: var(--danger);
}
button {
  font: inherit;
}
.primary-button,
.secondary-button,
.danger-button,
.danger-outline-button {
  border: 1px solid var(--theme-line);
  border-radius: 9px;
  padding: 8px 13px;
  cursor: pointer;
}
.primary-button {
  border-color: color-mix(in srgb, var(--text-primary) 84%, transparent);
  color: var(--surface-main);
  background: var(--text-primary);
}
.secondary-button {
  color: var(--text-primary);
  background: var(--surface-raised);
}
.danger-button {
  border-color: var(--danger);
  color: white;
  background: var(--danger);
}
.danger-outline-button {
  border-color: color-mix(in srgb, var(--danger) 45%, var(--theme-line));
  color: var(--danger);
  background: transparent;
}
.text-button {
  border: 0;
  padding: 4px;
  color: var(--text-secondary);
  background: transparent;
  cursor: pointer;
}
.compact {
  padding: 7px 11px;
}
button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}
.marketplace-empty-state {
  min-height: 220px;
  display: grid;
  place-content: center;
  justify-items: center;
  gap: 8px;
  color: var(--text-secondary);
  text-align: center;
}
.mine-list {
  display: grid;
  gap: 8px;
  margin-top: 18px;
}
.mine-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 9px;
  padding: 11px;
  border: 1px solid var(--theme-line-soft);
  border-radius: 10px;
  background: var(--surface-main);
}
.mine-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 9px;
}
.mine-main {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  border: 0;
  color: var(--text-primary);
  background: transparent;
  text-align: left;
  cursor: pointer;
}
.mine-main > span:last-child {
  display: grid;
  min-width: 0;
  gap: 3px;
}
.mine-main small {
  overflow: hidden;
  color: var(--text-tertiary);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.status-badge[data-status="pending"] {
  color: #9a6a12;
}
.status-badge[data-status="published"] {
  color: #2c8a55;
}
.status-badge[data-status="rejected"] {
  color: var(--danger);
}
.status-badge[data-status="deleted"] {
  color: var(--text-tertiary);
  text-decoration: line-through;
}
.publish-form {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
  margin-top: 18px;
}
.full-field {
  grid-column: 1 / -1;
}
.publish-metadata {
  grid-column: 1 / -1;
  display: flex;
  gap: 7px;
}
.publish-entry-list,
.group-publisher {
  display: grid;
  gap: 10px;
  color: var(--text-secondary);
  font-size: 12px;
}
.publish-entry-list article {
  display: grid;
  gap: 7px;
  padding: 12px;
  border: 1px solid var(--theme-line-soft);
  border-radius: 10px;
  background: var(--surface-main);
}
.group-candidate {
  grid-template-columns: auto 1fr auto;
  align-items: center;
  padding: 9px 10px;
  border: 1px solid var(--theme-line-soft);
  border-radius: 9px;
  background: var(--surface-main);
  cursor: pointer;
}
.group-candidate input {
  width: auto;
}
.group-candidate small {
  color: var(--text-tertiary);
}
.group-order-list {
  display: grid;
  gap: 6px;
  margin: 4px 0 0;
  padding-left: 22px;
}
.group-order-list li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px;
  border-radius: 8px;
  background: var(--surface-muted);
}
.group-order-list li span {
  min-width: 0;
  color: var(--text-primary);
}
.group-order-list li small {
  color: var(--text-tertiary);
  text-align: right;
}
.stable-help {
  padding: 11px 12px;
  border: 1px solid var(--theme-line-soft);
  border-radius: 9px;
  color: var(--text-secondary);
  background: var(--surface-muted);
  font-size: 12px;
  line-height: 1.5;
}
.marketplace-modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 2100;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(10, 12, 16, 0.48);
  backdrop-filter: blur(3px);
}
.marketplace-modal {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  width: min(760px, 94vw);
  max-height: 88vh;
  border: 1px solid var(--theme-line);
  border-radius: 16px;
  color: var(--text-primary);
  background: var(--surface-raised);
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.28);
  overflow: hidden;
}
.marketplace-modal > header,
.marketplace-modal > footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 15px 18px;
  border-bottom: 1px solid var(--theme-line-soft);
}
.marketplace-modal > footer {
  justify-content: flex-end;
  border-top: 1px solid var(--theme-line-soft);
  border-bottom: 0;
}
.marketplace-modal > header span {
  color: var(--text-tertiary);
  font-size: 11px;
}
.marketplace-modal > header h2 {
  margin: 2px 0 0;
  font-size: 20px;
}
.marketplace-modal > header > button {
  border: 0;
  color: var(--text-secondary);
  background: transparent;
  font-size: 24px;
  cursor: pointer;
}
.modal-scroll {
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 18px;
}
.detail-overview {
  margin: 0 0 18px;
  color: var(--text-secondary);
  line-height: 1.6;
}
.detail-category-tabs {
  display: flex;
  gap: 8px;
  margin: 0 0 8px;
  overflow-x: auto;
  scrollbar-width: thin;
}
.detail-category-tabs button {
  flex: 0 0 auto;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 7px;
  max-width: min(300px, 76vw);
  border: 1px solid var(--theme-line-soft);
  border-radius: 9px;
  padding: 8px 11px;
  color: var(--text-secondary);
  background: var(--surface-main);
  cursor: pointer;
}
.detail-category-tabs button:hover {
  border-color: var(--theme-line);
  color: var(--text-primary);
  background: var(--surface-hover);
}
.detail-category-tabs button.active {
  border-color: color-mix(in srgb, var(--accent) 55%, var(--theme-line));
  color: var(--text-primary);
  background: var(--accent-soft);
}
.detail-category-kind {
  border-radius: 999px;
  padding: 2px 7px;
  color: var(--accent);
  background: var(--surface-raised);
  font-size: 11px;
  font-weight: 700;
}
.detail-category-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.detail-skill-tabs {
  display: flex;
  gap: 6px;
  margin: 0 0 18px;
  padding: 4px;
  overflow-x: auto;
  border: 1px solid var(--theme-line-soft);
  border-radius: 10px;
  background: var(--surface-muted);
  scrollbar-width: thin;
}
.detail-skill-tabs button {
  flex: 0 0 auto;
  max-width: min(260px, 68vw);
  border: 1px solid transparent;
  border-radius: 7px;
  padding: 8px 12px;
  overflow: hidden;
  color: var(--text-secondary);
  background: transparent;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
}
.detail-skill-tabs button:hover {
  color: var(--text-primary);
  background: var(--surface-hover);
}
.detail-skill-tabs button.active {
  border-color: var(--theme-line);
  color: var(--text-primary);
  background: var(--surface-raised);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
}
.detail-category-tabs button:focus-visible,
.detail-skill-tabs button:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
.detail-markdown {
  min-width: 0;
}
.detail-markdown > h3 {
  margin-top: 0;
}
.detail-empty {
  margin: 0;
  padding: 28px 16px;
  border: 1px dashed var(--theme-line);
  border-radius: 10px;
  color: var(--text-tertiary);
  text-align: center;
  background: var(--surface-muted);
}
.install-bucket {
  display: grid;
  gap: 10px;
  padding: 12px;
  border: 1px solid var(--theme-line-soft);
  border-radius: 10px;
  background: var(--surface-main);
}
.install-bucket + .install-bucket {
  margin-top: 10px;
}
.install-bucket ol {
  margin: 0;
  padding-left: 23px;
  color: var(--text-secondary);
}
.delete-modal {
  width: min(500px, 94vw);
}
.delete-modal > p {
  margin: 0;
  padding: 20px;
  color: var(--text-secondary);
  line-height: 1.6;
}
@media (max-width: 1180px) {
  .marketplace-filters {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
  .search-field {
    grid-column: span 2;
  }
}
@media (max-width: 820px) {
  .marketplace-page {
    padding-inline: 16px;
  }
  .marketplace-header {
    align-items: flex-start;
  }
  .marketplace-filters,
  .publish-form {
    grid-template-columns: 1fr;
  }
  .search-field,
  .full-field {
    grid-column: 1;
  }
  .marketplace-pagination {
    align-items: flex-start;
    flex-direction: column;
  }
  .marketplace-pagination > div {
    width: 100%;
    flex-wrap: wrap;
    justify-content: flex-start;
  }
  .mine-row {
    grid-template-columns: 1fr auto;
  }
  .mine-actions {
    grid-column: 1 / -1;
    flex-wrap: wrap;
  }
}
</style>
