/**
 * Long-form workspace contracts. The domain is split by responsibility under
 * `long-workspace/`; this module is the single public entry point so callers
 * keep importing `@deepwrite/contracts` without knowing the internal layout.
 */
export * from "./long-workspace/primitives";
export * from "./long-workspace/ids";
export * from "./long-workspace/agents";
export * from "./long-workspace/worldbuilding";
export * from "./long-workspace/characters";
export * from "./long-workspace/plot";
export * from "./long-workspace/continuity";
export * from "./long-workspace/index-schema";
export * from "./long-workspace/index-validation-helpers";
export * from "./long-workspace/index-validation";
export * from "./long-workspace/navigation";
export * from "./long-workspace/book";
export * from "./long-workspace/latest-continuity";
