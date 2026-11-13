import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { compileFunction } from "node:vm";
import { describe, expect, it } from "vitest";

const desktopRequire = createRequire(
  new URL("../apps/desktop/package.json", import.meta.url)
);
const yaml = createRequire(desktopRequire.resolve("electron-builder"))(
  "js-yaml"
);
const workflow = yaml.load(
  await readFile(
    new URL("../.github/workflows/release.yml", import.meta.url),
    "utf8"
  )
);

function evaluate(expression, event, inputs, result = "success") {
  return compileFunction(`return (${expression.slice(3, -2)});`, [
    "github",
    "inputs",
    "env",
    "needs",
    "cancelled",
    "format"
  ])(
    { event_name: event },
    inputs,
    { RELEASE_TAG: "v9.8.7" },
    {
      prepare: { result: "success", outputs: { reuse_run_id: "" } },
      package: { result }
    },
    () => false,
    (template, value) => template.replace("{0}", value)
  );
}

describe("build-only release workflow", () => {
  it("defaults manual runs to retaining artifacts without publication", () => {
    expect(workflow.on.workflow_dispatch.inputs.publish.default).toBe(false);
    expect(
      evaluate(workflow.jobs.upload.if, "workflow_dispatch", { publish: false })
    ).toBe(false);
  });

  it("builds a selected source without requiring a release tag", () => {
    const checkout = workflow.jobs.prepare.steps.find(
      (step) => step.id === "source"
    );
    expect(
      evaluate(checkout.with.ref, "workflow_dispatch", {
        publish: false,
        source_ref: "a".repeat(40)
      })
    ).toBe("a".repeat(40));
    expect(
      evaluate(checkout.with.ref, "workflow_dispatch", {
        publish: true,
        source_ref: "a".repeat(40)
      })
    ).toBe("refs/tags/v9.8.7");
  });

  it.each(["push", "workflow_dispatch"])(
    "publishes verified tagged installers on an authorized %s run",
    (event) => {
      expect(evaluate(workflow.jobs.upload.if, event, { publish: true })).toBe(
        true
      );
      expect(
        evaluate(workflow.jobs.upload.if, event, { publish: true }, "failure")
      ).toBe(false);
    }
  );
});
