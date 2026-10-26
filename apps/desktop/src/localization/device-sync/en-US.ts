export default {
  checkingLocal: "Checking local save status",
  checkingRemote: "Checking remote changes",
  checkingUpdates: "Checking remote updates",
  checkedUpdates: "Remote updates checked; no content has been transferred",
  checkIncomplete: "Remote check incomplete; showing the previous check",
  firstPreview: "First sync preview",
  firstPreviewSummary:
    "{local} local items and {remote} remote items. Items are merged by identity; different works with the same name are kept separately.",
  confirmFirst: "Confirm the first sync",
  readingChanges: "Reading changes: {title}",
  uploading: "Uploading: {title}",
  downloading: "Downloading: {title}",
  transferFailed:
    "This work is being saved, has new changes, or uses an incompatible structure. Save it and try again.",
  validationFailed:
    "This work has an incompatible structure or missing references. Check the affected files and try again.",
  syncSummary: "Uploaded {uploaded} items; downloaded {downloaded} items",
  partialSummary:
    "Uploaded {uploaded} items; downloaded {downloaded} items; {issues} items incomplete",
  noChanges: "Check complete; no changes to transfer",
  previewIncomplete:
    "Initialization preview incomplete; local data is unchanged",
  initializationFailed:
    "Initialization incomplete; review the details and try again",
  cancelled: "Sync cancelled; saved content is unaffected",
  syncFailed: "Sync incomplete. Please try again.",
  restored: "Restored locally; changes will upload during the next manual sync",
  checkingSource: "Checking the initialization source",
  downloadingSource: "Downloading and validating: {title}",
  sourceReady:
    "Remote data downloaded and validated. Confirm to initialize this computer.",
  recheckingRemote: "Rechecking remote versions",
  replacingLocal: "Safely replacing local data. Please wait.",
  initialized:
    "This computer is initialized with the {count} items uploaded by “{device}”.",
  directionConflict:
    "Both local and remote copies have changed. Merge the changes first; neither copy has been overwritten.",
  mergeConflict:
    "Changes on both sides need confirmation. Other works will continue syncing.",
  deletionPending:
    "Content was deleted on the other device. Confirm to apply the deletion.",
  noLocalVersion:
    "There is no local version to use. Missing content has not been synced as a deletion.",
  remoteDiverged:
    "Remote devices have different versions. Sync the source devices first, or use the local version.",
  noRemoteVersion:
    "There is no remote version to use. Upload from the other device and try again.",
  missingDependencies:
    "Linked resources are not ready. Add the corresponding libraries and resolve their sync issues.",
  referencedResource:
    "This resource is still referenced by {sources}. Remove the links first, or confirm deletion of the referring items as well.",
  remoteReadFailed: "Could not read the remote work: {reason}",
  remoteInvalid:
    "The remote work failed integrity checks. This work has not been changed.",
  localInvalid:
    "This work directory cannot be read or has an incompatible structure. It is excluded from this sync.",
  beforeRestore: "Version before history restore",
  beforeSync: "Version before sync",
  receivedChanges: "Changes received from {device}",
  receivedRemote: "Changes received from remote storage",
  preparedUpload: "Local changes ready to upload",
  uploaded: "Local changes synced to remote storage",
  legacyHistory: "Sync history record",
  syncingConversations: "Syncing conversations: {title}",
  conversationsBusy:
    "The work's conversations are in use. They will sync next time.",
  conversationsChanged:
    "Some conversations changed on this device and will be merged next time.",
  conversationsFailed: "Conversations could not be synced. Try again later.",
  conversationsUnreadable:
    "A device's conversation records could not be read and were skipped.",
  conversationsWorkMissing:
    "The work is not on this device, so its conversations are not synced."
} as const;
