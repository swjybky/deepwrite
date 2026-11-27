import {
  longChapterCharacterCurrentStateFileId,
  longChapterCharacterHistoryFileId,
  longChapterCharacterContinuityFilePath,
  type DecompositionAsset,
  type DecompositionRegistry,
  type LongBookDecompositionJob,
  type LongWorkspaceIndexSnapshot
} from "@deepwrite/contracts";
import { decompositionResourceId } from "./identity";
import type { NativeAssetWriter } from "./long-native-assets";

export async function writeLatestCharacterContinuity(
  job: LongBookDecompositionJob,
  index: LongWorkspaceIndexSnapshot,
  registry: DecompositionRegistry,
  assets: DecompositionAsset[],
  writer: NativeAssetWriter
) {
  const latest = index.chapters.at(-1)!;
  for (const entry of registry.characters.filter(
    ({ tier, ignored }) =>
      !ignored && (tier === "protagonist" || tier === "major_supporting")
  )) {
    if (job.units[`character:${entry.id}`]?.status === "skipped") continue;
    const dossier = assets.find(
      (asset) => asset.kind === "character" && asset.registryId === entry.id
    );
    if (!dossier || dossier.kind !== "character")
      throw new Error("最新连续性依赖的人物档案缺失。");
    const characterId = decompositionResourceId("character", job.id, entry.id);
    const ref = (id: string, filename: "current-state.md" | "history.md") => ({
      id,
      path: longChapterCharacterContinuityFilePath(
        latest.chapterCardId,
        characterId,
        filename
      ),
      updatedAt: new Date().toISOString()
    });
    let files = latest.characterContinuity.find(
      (item) => item.characterId === characterId
    );
    if (!files) {
      files = {
        characterId,
        currentState: ref(
          longChapterCharacterCurrentStateFileId(
            latest.chapterCardId,
            characterId
          ),
          "current-state.md"
        ),
        history: ref(
          longChapterCharacterHistoryFileId(latest.chapterCardId, characterId),
          "history.md"
        )
      };
      latest.characterContinuity.push(files);
    }
    await writer.file(files.currentState, dossier.latestState);
    await writer.file(files.history, dossier.history);
  }
}
