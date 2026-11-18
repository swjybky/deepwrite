import { z } from "zod";

export const ACADEMIC_CITATION_STYLES = [
  "gbt7714",
  "apa",
  "ieee",
  "latex",
  "none"
] as const;

export const AcademicCitationStyleSchema = z.enum(ACADEMIC_CITATION_STYLES);
export type AcademicCitationStyle = z.infer<typeof AcademicCitationStyleSchema>;

export type AcademicCitationStyleLocale = "zh-CN" | "en-US";

export function academicCitationStyleRequirements(
  style: AcademicCitationStyle,
  locale: AcademicCitationStyleLocale = "zh-CN"
): string {
  if (locale === "en-US") {
    switch (style) {
      case "gbt7714":
        return [
          "Citation Style Constraint (GB/T 7714-2015):",
          "- Use sequential numeric bracket citations in body text (e.g., `[1]`, `[2-4]`) or author-year consistently according to the manuscript convention, mapped strictly to verified reference cards.",
          "- Format the trailing `References` (`参考文献`) section strictly following GB/T 7714-2015 (`[1] Author. Title[J]. Journal, Year, Vol(Issue): Pages.`), ordered to match the in-text citation order.",
          "- Never fabricate bibliographic metadata, DOIs, or page numbers; emit `[Citation needed: ...]` when a reference card is missing."
        ].join("\n");
      case "apa":
        return [
          "Citation Style Constraint (APA 7th Edition):",
          "- Use author-date parenthetical or narrative citations in body text (e.g., `(Smith, 2023)`, `Vaswani et al. (2017)`), mapped strictly to verified reference cards.",
          "- Format the trailing `References` section strictly in APA 7th order (alphabetical by first author surname, `Author, A. A. (Year). Title. Source. DOI`).",
          "- Never fabricate bibliographic metadata or DOIs; emit `[Citation needed: ...]` when a reference card is missing."
        ].join("\n");
      case "ieee":
        return [
          "Citation Style Constraint (IEEE):",
          "- Use sequential square-bracket numeric citations in body text in order of first appearance (e.g., `[1]`, `[2], [3]`, `[4]–[6]`), treating each bracketed number as a noun phrase.",
          '- Format the trailing `References` section in numerical order (`[1] A. Author, "Title," Abbrev. Journal, vol. X, no. Y, pp. Z1–Z2, Month Year.`).',
          "- Never fabricate bibliographic metadata or DOIs; emit `[Citation needed: ...]` when a reference card is missing."
        ].join("\n");
      case "latex":
        return [
          "Citation Style Constraint (LaTeX / BibTeX citeKey):",
          "- Cite verified `literature` reference cards in body text using exact card `citeKey` commands (`\\cite{citeKey}` or `\\citep{citeKey}` / `\\citet{citeKey}` consistently).",
          "- Keep `citeKey` tokens identical to the project's Reference Cards index; in the trailing `References` section, list structured entries keyed by `[citeKey]` or BibTeX-ready entries.",
          "- Never invent unverified `citeKey` identifiers; emit `[Citation needed: ...]` when a reference card is missing."
        ].join("\n");
      case "none":
        return [
          "Citation Style Constraint (Unrestricted / Technical Article):",
          "- Formal bibliography formatting is not enforced unless explicitly requested, but factual claims, quantitative metrics, and attributed findings must still match verified Reference Cards or bound Material Libraries.",
          "- Never fabricate papers, benchmarks, or numerical results; emit `[Citation needed: ...]` or `[Data needed: ...]` when evidence is missing."
        ].join("\n");
    }
  }

  switch (style) {
    case "gbt7714":
      return [
        "【引用体例硬约束：GB/T 7714-2015】",
        "- 正文内采用顺序编码制（如 `[1]`、`[2-4]`）或著者-出版年制并保持全文统一，所有引用必须严格对应作品已核实的「文献与证据卡」。",
        "- 文末 `参考文献` 小节须严格遵循 GB/T 7714-2015 著录规范（含文献类型标识 `[J]`/`[C]`/`[M]`/`[D]`/`[EB/OL]` 等），编号顺序与正文首次引用顺序一致。",
        "- 严禁编造未核实的题录、期刊卷期页码或 DOI；缺失处必须输出 `[待补引用: ...]` 显式占位。"
      ].join("\n");
    case "apa":
      return [
        "【引用体例硬约束：APA 第 7 版】",
        "- 正文内采用著者-出版年制引用（如 `(Vaswani et al., 2017)` 或 `Smith (2023)`），所有引用必须严格对应已核实的「文献与证据卡」。",
        "- 文末 `参考文献`（`References`）按第一作者姓氏字母序排列，严格遵循 APA 7th 格式著录作者、年份、标题、来源与 DOI。",
        "- 严禁编造未核实的题录或 DOI；缺失处必须输出 `[待补引用: ...]` 显式占位。"
      ].join("\n");
    case "ieee":
      return [
        "【引用体例硬约束：IEEE】",
        "- 正文内按首次出现顺序使用方括号数字编号引用（如 `[1]`、`[2], [3]`、`[4]–[6]`），每个编号严格对应已核实的「文献与证据卡」。",
        "- 文末 `参考文献`（`References`）按正文引用序号升序排列，遵循 IEEE 期刊/会议著录规范（缩写名在姓前、题名加引号、刊名/会议名规范缩写）。",
        "- 严禁编造未核实的题录、会议/期刊信息或 DOI；缺失处必须输出 `[待补引用: ...]` 显式占位。"
      ].join("\n");
    case "latex":
      return [
        "【引用体例硬约束：LaTeX / BibTeX 引用键】",
        "- 正文内统一使用作品「文献与证据卡」中的精确 `citeKey` 进行标注（如 `\\cite{citeKey}`，或全文统一使用 `\\citep{citeKey}` / `\\citet{citeKey}`）。",
        "- 引用键拼写必须与卡片索引中的 `citeKey` 完全一致；文末 `参考文献` 小节按 `[citeKey]` 列出核实题录或 BibTeX 条目。",
        "- 严禁臆造卡片库中不存在的 `citeKey` 或题录信息；缺失处必须输出 `[待补引用: ...]` 显式占位。"
      ].join("\n");
    case "none":
      return [
        "【引用体例硬约束：无强制题录体例（学术解读 / 技术报告）】",
        "- 不强制要求标准学术文末著录格式，但凡涉及他人成果、实验指标、统计口径与核心事实，仍须以「文献与证据卡」或已绑定素材库为准。",
        "- 严禁编造论文出处与实验数值；缺失处必须输出 `[待补引用: ...]` 或 `[待补数据: ...]` 显式占位。"
      ].join("\n");
  }
}
