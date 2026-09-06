export interface EditorSearchHighlightMatch {
  start: number;
  end: number;
}

export interface EditorSearchHighlightSegment {
  text: string;
  match: boolean;
  active: boolean;
}

const DEFAULT_MAX_HIGHLIGHTED_MATCHES = 500;

function visibleMatchWindow(
  matches: readonly EditorSearchHighlightMatch[],
  activeIndex: number,
  maximum: number
): Array<{ match: EditorSearchHighlightMatch; sourceIndex: number }> {
  if (matches.length <= maximum) {
    return matches.map((match, sourceIndex) => ({ match, sourceIndex }));
  }

  const halfWindow = Math.floor(maximum / 2);
  const preferredStart = activeIndex >= 0 ? activeIndex - halfWindow : 0;
  const start = Math.max(0, Math.min(preferredStart, matches.length - maximum));
  return matches
    .slice(start, start + maximum)
    .map((match, index) => ({ match, sourceIndex: start + index }));
}

export function buildEditorSearchHighlightSegments(
  content: string,
  matches: readonly EditorSearchHighlightMatch[],
  activeIndex: number,
  maximum = DEFAULT_MAX_HIGHLIGHTED_MATCHES
): EditorSearchHighlightSegment[] {
  if (!content || !matches.length || maximum <= 0) return [];

  const segments: EditorSearchHighlightSegment[] = [];
  let cursor = 0;
  for (const { match, sourceIndex } of visibleMatchWindow(
    matches,
    activeIndex,
    maximum
  )) {
    const start = Math.max(cursor, Math.min(match.start, content.length));
    const end = Math.max(start, Math.min(match.end, content.length));
    if (end <= start) continue;
    if (start > cursor) {
      segments.push({
        text: content.slice(cursor, start),
        match: false,
        active: false
      });
    }
    segments.push({
      text: content.slice(start, end),
      match: true,
      active: sourceIndex === activeIndex
    });
    cursor = end;
  }

  if (cursor < content.length) {
    segments.push({
      text: content.slice(cursor),
      match: false,
      active: false
    });
  }
  if (content.endsWith("\n")) {
    segments.push({ text: "\u200b", match: false, active: false });
  }
  return segments;
}
