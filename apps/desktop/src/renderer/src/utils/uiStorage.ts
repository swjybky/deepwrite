/** Browser storage for interface preferences; the only module that names localStorage. */
export function uiStorage(): Storage {
  return (typeof window !== "undefined" && window.localStorage) || localStorage;
}

export function optionalUiStorage(): Storage | null {
  return typeof window === "undefined" ? null : window.localStorage;
}
