import { readFileSync } from "node:fs";
import { compile } from "vue";
import { compileScript, parse } from "vue/compiler-sfc";

export function compileClientRender(file) {
  const { descriptor } = parse(readFileSync(file, "utf8"), {
    filename: file.pathname
  });
  if (!descriptor.template) {
    throw new Error(`Missing template in ${file.pathname}`);
  }
  return compile(descriptor.template.content, {
    prefixIdentifiers: true,
    bindingMetadata: compileScript(descriptor, { id: file.pathname }).bindings
  });
}
