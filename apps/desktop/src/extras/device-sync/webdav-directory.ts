import { syncPathSchema } from "@deepwrite/contracts";

function decodeXml(value: string): string {
  return value.replace(
    /&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi,
    (_, entity: string) => {
      const named: Record<string, string> = {
        amp: "&",
        lt: "<",
        gt: ">",
        quot: '"',
        apos: "'"
      };
      if (named[entity]) return named[entity];
      const number = entity.startsWith("#x")
        ? parseInt(entity.slice(2), 16)
        : parseInt(entity.slice(1), 10);
      if (!Number.isInteger(number) || number < 0 || number > 0x10ffff)
        throw new Error("网盘目录编码无效。");
      return String.fromCodePoint(number);
    }
  );
}
export function parseDavNames(xml: string, requested: URL): string[] {
  if (
    /<!DOCTYPE|<!ENTITY/i.test(xml) ||
    !/<(?:[\w.-]+:)?multistatus[\s>]/i.test(xml)
  )
    throw new Error("服务器未返回有效的 WebDAV 目录。");
  const names: string[] = [];
  if (!/<\/(?:[\w.-]+:)?multistatus\s*>/i.test(xml))
    throw new Error("网盘目录不完整。");
  const parent = decodeURIComponent(requested.pathname).replace(/\/$/, "");
  for (const block of xml.matchAll(
    /<(?:[\w.-]+:)?response[\s>][\s\S]*?<\/(?:[\w.-]+:)?response\s*>/gi
  )) {
    if (/<(?:[\w.-]+:)?status[^>]*>HTTP\/\S+ (?:4|5)\d\d/i.test(block[0]))
      throw new Error("网盘目录部分读取失败。");
    const href = block[0].match(
      /<(?:[\w.-]+:)?href\s*>([\s\S]*?)<\/(?:[\w.-]+:)?href\s*>/i
    )?.[1];
    if (!href) throw new Error("网盘目录缺少文件路径。");
    const target = new URL(decodeXml(href.trim()), requested);
    const path = decodeURIComponent(target.pathname).replace(/\/$/, "");
    if (target.origin !== requested.origin || target.search || target.hash)
      throw new Error("网盘返回了目录以外的路径。");
    if (path === parent) continue;
    if (!path.startsWith(`${parent}/`))
      throw new Error("网盘返回了目录以外的路径。");
    const name = path.slice(parent.length + 1);
    if (name.includes("/") || !syncPathSchema.safeParse(name).success)
      throw new Error("网盘目录路径无效。");
    names.push(name);
  }
  return names;
}
