import { builtinEnvironments, type Environment } from "vitest/runtime";

export default {
  ...builtinEnvironments.node,
  name: "renderer",
  viteEnvironment: "client"
} satisfies Environment;
