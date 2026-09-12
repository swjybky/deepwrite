import type {
  ConversationHistoryApi,
  ConversationHistoryDetailResult
} from "@deepwrite/contracts";

export type HistoryReadApi = Pick<
  ConversationHistoryApi,
  "messages" | "detail" | "metadataDetail" | "turns"
>;
export type HistoryPinReason =
  "active" | "editing" | "pending-approval" | "expanded" | "unsaved";
// Bound expansion for the recursive Json contract; containers are deeply frozen at runtime.
export type ImmutableHistory<
  T,
  Depth extends unknown[] = []
> = Depth["length"] extends 5
  ? Readonly<T>
  : T extends object
    ? { readonly [K in keyof T]: ImmutableHistory<T[K], [...Depth, unknown]> }
    : T;
interface DetailReference {
  path: (string | number)[];
  byteLength: number;
  encoding: ConversationHistoryDetailResult["encoding"];
}
export type HistoryDetailTarget = DetailReference &
  ({ kind: "metadata" } | { kind?: "message"; messageId: string });
export interface HistoryReaderOptions {
  maxCacheBytes?: number;
  maxCacheEntries?: number;
  /** Larger values must be consumed through streamDetail(), never implicitly joined. */
  maxMaterializedDetailBytes?: number;
}

export class HistoryReadCancelledError extends Error {
  constructor() {
    super("Conversation history read was cancelled.");
    this.name = "AbortError";
  }
}
export class HistoryReadConflictError extends Error {
  constructor(
    readonly expectedRevision: number,
    readonly actualRevision: number
  ) {
    super(
      "Conversation history changed while reading. Open a new snapshot to retry."
    );
    this.name = "HistoryReadConflictError";
  }
}
export class HistoryCacheCapacityError extends Error {
  constructor() {
    super(
      "Conversation history cache is full; release unused pins or consume detail chunks."
    );
    this.name = "HistoryCacheCapacityError";
  }
}
export class HistoryDetailRequiresStreamingError extends Error {
  constructor(
    readonly byteLength: number,
    readonly maxBytes: number
  ) {
    super(
      "This detail exceeds the materialization budget; use streamDetail()."
    );
    this.name = "HistoryDetailRequiresStreamingError";
  }
}
