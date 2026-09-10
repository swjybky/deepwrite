export async function loadDefaultStyleComparisonMethod(): Promise<string> {
  const { DEFAULT_STYLE_COMPARISON_METHOD } =
    await import("./style-comparison-method");
  return DEFAULT_STYLE_COMPARISON_METHOD;
}
