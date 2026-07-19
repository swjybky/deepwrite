export type ComposerReferenceTrigger = "/" | "@";

export interface ComposerReferenceMatch {
  trigger: ComposerReferenceTrigger;
  start: number;
  caret: number;
  query: string;
}

export interface ComposerReferenceInsertion {
  value: string;
  caret: number;
}

const INVALID_PRECEDING_TRIGGER_CHARACTER = /[A-Za-z0-9_./:-]/;

export function findComposerReferenceMatch(
  value: string,
  caret: number
): ComposerReferenceMatch | null {
  const safeCaret = Math.max(0, Math.min(caret, value.length));
  const beforeCaret = value.slice(0, safeCaret);
  const slashIndex = beforeCaret.lastIndexOf("/");
  const mentionIndex = beforeCaret.lastIndexOf("@");
  const start = Math.max(slashIndex, mentionIndex);
  if (start < 0) {
    return null;
  }

  const query = beforeCaret.slice(start + 1);
  if (/\s|[/@]/u.test(query)) {
    return null;
  }
  const preceding = start > 0 ? value[start - 1] : undefined;
  if (preceding && INVALID_PRECEDING_TRIGGER_CHARACTER.test(preceding)) {
    return null;
  }

  return {
    trigger: value[start] as ComposerReferenceTrigger,
    start,
    caret: safeCaret,
    query
  };
}

export function insertComposerReference(
  value: string,
  match: ComposerReferenceMatch,
  label: string
): ComposerReferenceInsertion {
  const prefix = value.slice(0, match.start);
  const suffix = value.slice(match.caret);
  const needsTrailingSpace =
    suffix.length === 0 || !/^[\s，。！？；：、）)】\]}]/u.test(suffix);
  const insertion = `${match.trigger}${label}${needsTrailingSpace ? " " : ""}`;
  return {
    value: `${prefix}${insertion}${suffix}`,
    caret: prefix.length + insertion.length
  };
}
