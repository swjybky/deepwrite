import type {
  SyncClock,
  SyncCommit,
  SyncConfig,
  SyncHistory,
  SyncItem,
  SyncMetadata,
  SyncSpace
} from "./schemas";

export type SyncPhase =
  | "idle"
  | "saving"
  | "checking"
  | "transferring"
  | "applying"
  | "complete"
  | "partial"
  | "cancelled"
  | "failed";
export type SyncDirection = "both" | "upload" | "download";
export type SyncAdoptionSide = "local" | "remote";
export interface SyncAdoption {
  side: SyncAdoptionSide;
  keys: string[];
}
export interface SyncProgress {
  phase: SyncPhase;
  completed: number;
  total: number;
  title: string;
  filesCompleted?: number | undefined;
  filesTotal?: number | undefined;
}
export interface SyncIssue {
  key: string;
  title: string;
  token: string;
  reason:
    "conflict" | "delete" | "unsupported" | "busy" | "failed" | "first-sync";
  message: string;
  paths: string[];
  local: SyncItem | null;
  base?: SyncItem | null | undefined;
  versions: { deviceName: string; item: SyncItem | null; clock: SyncClock }[];
}
export interface SyncResolution {
  token: string;
  item: SyncItem | null;
}
export interface SyncDevice {
  id: string;
  name: string;
  updatedAt: string;
  receivedCurrent: boolean;
}
export interface SyncStatus {
  config: SyncConfig | null;
  credentialSaved: boolean;
  deviceId: string;
  progress: SyncProgress;
  lastSuccessAt: string | null;
  lastCheckedAt: string | null;
  firstSyncConfirmed: boolean;
  items: {
    key: string;
    title: string;
    kind: SyncItem["kind"];
    included: boolean;
    dirty: boolean;
    remoteDirty: boolean;
  }[];
  issues: SyncIssue[];
  devices: SyncDevice[];
  history: (Omit<SyncHistory, "item"> & { canRestore: boolean })[];
}
export interface SyncTransport {
  get(path: string, signal?: AbortSignal): Promise<string | null>;
  put(path: string, content: string, signal?: AbortSignal): Promise<void>;
  list(path: string, signal?: AbortSignal): Promise<string[]>;
  mkdir(path: string, signal?: AbortSignal): Promise<void>;
  remove(path: string, signal?: AbortSignal): Promise<void>;
  test(signal?: AbortSignal): Promise<void>;
}
export interface SyncWorkspacePort {
  list(): Promise<{
    items: SyncItem[];
    issues: { key: string; title: string; message: string }[];
  }>;
  /** The implementation must compare expected while holding its project write queue. */
  apply(
    key: string,
    expected: SyncItem | null,
    next: SyncItem | null
  ): Promise<void>;
  validate(item: SyncItem): Promise<void>;
  recover(): Promise<void>;
}
export interface SyncMetadataStore {
  read(): Promise<SyncMetadata | null>;
  write(value: SyncMetadata): Promise<void>;
}
export interface SyncCredentialStore {
  get(): Promise<string | null>;
  set(value: string): Promise<void>;
  delete(): Promise<void>;
}
export interface SyncRuntime {
  hash(value: string): string;
  id(): string;
  now(): string;
}
export interface SyncServiceOptions {
  metadata: SyncMetadataStore;
  credentials: SyncCredentialStore;
  workspace: SyncWorkspacePort;
  runtime: SyncRuntime;
  transport(config: SyncConfig, password: string): SyncTransport;
}
export interface SyncApi {
  status(): Promise<SyncStatus>;
  check(): Promise<SyncStatus>;
  connect(config: SyncConfig, password: string): Promise<SyncSpace[]>;
  join(spaceId: string | null, name?: string): Promise<SyncStatus>;
  configure(config: SyncConfig): Promise<SyncStatus>;
  joinCode(): Promise<string>;
  sync(
    resolutions?: SyncResolution[],
    confirmFirst?: boolean,
    direction?: SyncDirection,
    adoption?: SyncAdoption
  ): Promise<SyncStatus>;
  cancel(): void;
  restore(historyId: string): Promise<SyncStatus>;
}
export interface LoadedSyncDevice {
  hash: string;
  commit: SyncCommit;
}
