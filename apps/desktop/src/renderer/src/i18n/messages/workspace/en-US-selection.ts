export default {
  protagonist: "Protagonists",
  majorSupporting: "Major supporting characters",
  minorSupporting: "Minor supporting characters",
  passerby: "Background characters",

  currentState: "Current state",
  history: "History",
  profile: "Profile",
  relationships: "Relationships",
  overview: "Overview",
  characters: "Characters",
  characterOverviewHelp:
    "Overview of all characters, helping the agent locate detailed profiles.",
  emptyCharacterGroup:
    "No {groupLabel} yet. Use the plus button beside the character tabs to create one.",
  characterIndexPending: "The profile index for {name} is not ready yet.",
  characterStateReadonly:
    "Current state and history reflect the latest committed chapter and are read-only.",
  characterStateEmpty:
    "No committed chapter records exist for this character. Current state and history are empty.",
  plotDesign: "Plot design",
  plotPoints: "Plot points",
  emptyVolumePlot:
    "{title} has no plot points yet. Use the plus button beside the volume to create one.",
  manuscript: "Manuscript",
  chapterEndState: "Chapter-end state",
  nextChapterHandoff: "Next chapter handoff",
  continuityEditable:
    "This chapter has continuity records for reference. The manuscript remains editable.",
  completedEditable:
    "This chapter is complete. You can keep editing or add continuity records as needed.",
  nextBlankChapter:
    "This is the next blank chapter card in sequence. You can start writing this chapter.",
  blankChapterOrder:
    "This chapter is blank. Complete the earlier blank chapters before starting automatic writing.",
  bookStoryline: "Book storyline",
  storyline: "Storyline",
  foreshadowing: "Foreshadowing overview",
  foreshadowingHelp:
    "Manage foreshadowing threads and their introduction, development, revelation, and resolution.",
  worldRevelations: "World revelations",
  worldbuilding: "Worldbuilding",
  worldRevelationsReadonly:
    "Read-only view of the latest committed chapter containing world revelations.",
  worldRevelationsEmpty: "No world revelation records have been committed yet.",
  worldbuildingContent: "Worldbuilding content",
  migrationEvidence:
    "Read-only evidence generated during migration, available for search and agent reference.",
  worldbuildingListHelp:
    "List-based worldbuilding. Switch between item tabs to edit their content.",
  worldbuildingTextHelp: "Text-based worldbuilding.",
  continuityLedger: "Continuity ledger",
  chapterRecords: "Chapter records",
  combinedContinuity:
    "{committedAt} · Final continuity summary shared by {length} chapters",
  namedCurrentState: "{name} · Current state",
  namedHistory: "{name} · History",
  manuscriptEvidence: "Manuscript evidence",
  foreshadowingChanges: "Foreshadowing changes",
  handoff: "Handoff",
  checkpointHelp:
    "An import checkpoint only marks historical text as archived. It does not mean continuity facts, chapter-end states, or handoffs have been generated.",
  chapterContinuityHelp:
    "The latest ledger entry’s final chapter is editable. Earlier continuity records and manuscript evidence are read-only.",
  pendingContinuityHelp:
    "Pending chapter. Only existing foreshadowing touchpoints linked to this chapter are checked; no records are generated when there are no candidates.",
  listOnly: "Only list-based worldbuilding categories support adding items.",
  itemLimit: "A worldbuilding category supports up to 10,000 items.",
  newItem: "New item {sequence}"
} as const;
