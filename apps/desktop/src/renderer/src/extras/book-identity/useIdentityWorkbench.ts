import { identityApi } from "./book-identity-utils";
import { computed, onMounted, ref, watch } from "vue";
import {
  CoverAspectRatioSchema,
  imageModelCapability,
  ExtrasAgentTaskSchema,
  type BookIdentityCandidate,
  type BookIdentityField,
  type BookIdentityRound,
  type BookCoverCandidate,
  type CoverAspectRatio,
  type ImageModelSettings,
  type ModelConfig,
  type ThinkingLevel
} from "@deepwrite/contracts/renderer";
import { useBookIdentity } from "./useBookIdentity";
import { useIdentityBooks } from "./useIdentityBooks";
import {
  useIdentityProfiles,
  type IdentityProfileCatalogs
} from "./useIdentityProfiles";
import { useIdentityGenerationSettings } from "./useIdentityGenerationSettings";
import { useIdentityRun } from "./useIdentityRun";
import { useCoverRenderQueue } from "./useCoverRenderQueue";
import { fields, agentIds, identityT as t } from "./book-identity-utils";
import { formatError } from "../../i18n/errors";
import { uiMessage } from "../../ui-feedback";
import { useIdentityCandidateEditing } from "./useIdentityCandidateEditing";
export function useIdentityWorkbench(
  props: { models: readonly ModelConfig[]; preferredModelId: string | null },
  refreshCatalog: () => void
) {
  const books = useIdentityBooks();
  const { book, selected } = books;
  const field = ref<BookIdentityField>("title");
  const c = useBookIdentity(book);
  const { record, loading, counts, writable } = c;
  const profiles = useIdentityProfiles(field);
  const run = useIdentityRun(book, field);
  const queue = useCoverRenderQueue();
  const profileId = profiles.selectedId;
  const seeds = ref<BookIdentityCandidate[]>([]);
  const modelId = ref(
    props.models.find(
      (m) => m.id === props.preferredModelId && m.enabled !== false
    )?.id ??
      props.models.find((m) => m.enabled !== false)?.id ??
      ""
  );
  const thinkingLevel = ref<ThinkingLevel>("off");
  const model = computed(() =>
    props.models.find((m) => m.id === modelId.value && m.enabled !== false)
  );
  watch(
    () => props.models,
    () => {
      if (!model.value)
        modelId.value =
          props.models.find(
            (m) => m.id === props.preferredModelId && m.enabled !== false
          )?.id ??
          props.models.find((m) => m.enabled !== false)?.id ??
          "";
    }
  );
  watch(
    model,
    (selected, previous) => {
      if (!selected) {
        thinkingLevel.value = "off";
      } else if (
        selected.id !== previous?.id ||
        (thinkingLevel.value !== "off" &&
          !selected.thinkingLevelOptions.includes(thinkingLevel.value))
      ) {
        thinkingLevel.value = selected.defaultThinkingLevel;
      }
    },
    { immediate: true, flush: "sync" }
  );
  const imageSettings = ref<ImageModelSettings>({
    profiles: [],
    activeProfileId: null
  });
  const imageProfile = computed(() =>
    imageSettings.value.profiles.find(
      (p) => p.id === imageSettings.value.activeProfileId && p.hasApiKey
    )
  );
  const ratios = computed<CoverAspectRatio[]>(() =>
    imageProfile.value
      ? imageModelCapability(
          imageProfile.value.presetId,
          imageProfile.value.model
        ).aspectRatios
      : CoverAspectRatioSchema.options
  );
  const { count, brief, images, ratio, titleRendering, autoRender } =
    useIdentityGenerationSettings(field, profiles.selected, ratios);
  watch(book, () => {
    seeds.value = [];
    editor.value = null;
    composer.value = null;
  });
  watch(field, () => {
    seeds.value = [];
    editor.value = null;
    composer.value = null;
  });
  const starredOnly = ref(false),
    managerOpen = ref(false);
  const rounds = computed(
    () =>
      c.visibleRecord.value?.rounds
        .filter(
          (r) =>
            r.field === field.value &&
            (!starredOnly.value || r.candidates.some((c) => c.starred))
        )
        .slice()
        .reverse() ?? []
  );
  const editing = useIdentityCandidateEditing(c, book, field);
  const { editor, composer } = editing;
  async function act(operation: () => Promise<unknown>) {
    try {
      return await operation();
    } catch (error) {
      uiMessage.error(formatError(error, t("failed")));
      return undefined;
    }
  }
  async function loadImages() {
    imageSettings.value = await identityApi().imageModels.getSettings();
  }
  onMounted(() => {
    void act(books.load);
    void act(profiles.load);
    void act(loadImages);
  });
  async function start() {
    if (!book.value || !profiles.selected.value || !writable.value) return;
    try {
      const base = {
        jobId: run.newJobId(),
        book: { ...book.value },
        candidateCount: count.value,
        brief: brief.value,
        seedCandidateIds: seeds.value.map((c) => c.id)
      };
      const task = ExtrasAgentTaskSchema.parse({
        agentId: agentIds[field.value],
        profileId: profileId.value,
        input:
          field.value === "cover"
            ? {
                ...base,
                imagesPerCandidate: images.value,
                aspectRatio: ratio.value,
                titleRendering: titleRendering.value,
                autoRender: autoRender.value
              }
            : base
      });
      if (
        task.agentId === "book-title-design" ||
        task.agentId === "book-synopsis-design" ||
        task.agentId === "book-cover-design"
      )
        await run.start(task, model.value, thinkingLevel.value);
    } catch (error) {
      uiMessage.error(formatError(error, t("failed")));
    }
  }
  async function saveProfiles(value: IdentityProfileCatalogs) {
    try {
      for (const target of fields) {
        if (
          JSON.stringify(value[target]) !==
          JSON.stringify(profiles.catalogs.value[target])
        )
          await profiles.save(value[target], target);
      }
      managerOpen.value = false;
    } catch (error) {
      uiMessage.error(formatError(error, t("failed")));
    }
  }
  async function setDefault() {
    const profile = profiles.selected.value;
    if (!profile) return;
    try {
      await profiles.save(
        profiles.profiles.value.map((p) =>
          p.id === profile.id
            ? {
                ...p,
                candidateCount: count.value,
                ...("imagesPerCandidate" in p
                  ? {
                      imagesPerCandidate: images.value,
                      aspectRatio: ratio.value,
                      titleRendering: titleRendering.value,
                      autoRender: autoRender.value
                    }
                  : {})
              }
            : p
        )
      );
      uiMessage.success(t("defaultSaved"));
    } catch (error) {
      uiMessage.error(formatError(error, t("failed")));
    }
  }
  function iterate(candidate: BookIdentityCandidate) {
    if (seeds.value.some((c) => c.id === candidate.id)) return;
    if (seeds.value.length >= 5) {
      uiMessage.warning(t("maxSeeds"));
      return;
    }
    seeds.value.push(candidate);
  }
  function render(round: BookIdentityRound, candidate: BookCoverCandidate) {
    if (!book.value || !imageProfile.value) {
      uiMessage.warning(t("imageRequired"));
      return;
    }
    queue.add(book.value, round.id, candidate.id);
  }
  async function rename(title: string) {
    await books.rename(title);
    refreshCatalog();
  }
  return {
    books,
    book,
    selected,
    field,
    c,
    record,
    loading,
    counts,
    writable,
    profiles,
    run,
    queue,
    profileId,
    count,
    brief,
    seeds,
    images,
    ratio,
    titleRendering,
    autoRender,
    model,
    modelId,
    thinkingLevel,
    imageProfile,
    ratios,
    starredOnly,
    managerOpen,
    rounds,
    act,
    start,
    saveProfiles,
    setDefault,
    iterate,
    render,
    rename,
    ...editing
  };
}
