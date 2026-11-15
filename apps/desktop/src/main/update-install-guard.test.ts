import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: {}, dialog: {} }));

import { foreignAppProcesses, parseAppProcesses } from "./update-install-guard";

const EXE =
  "C:\\Users\\writer\\AppData\\Local\\Programs\\DeepWrite\\DeepWrite.exe";
const OWN = 100;

describe("update install guard", () => {
  it("parses process rows and skips lines without a path", () => {
    expect(
      parseAppProcesses(
        `100\t7\t${EXE}\r\n200\t300\t\r\nnoise\r\n400\t500\t${EXE}\r\n`
      )
    ).toEqual([
      { pid: 100, parentPid: 7, path: EXE },
      { pid: 400, parentPid: 500, path: EXE }
    ]);
  });

  it("counts processes outside the app's own tree", () => {
    const rows = [
      { pid: OWN, parentPid: 7, path: EXE },
      { pid: 101, parentPid: OWN, path: EXE },
      { pid: 102, parentPid: 101, path: EXE },
      // An MCP bridge started by an agent client.
      { pid: 200, parentPid: 900, path: EXE.toLowerCase() },
      // Another installation is not this one's concern.
      { pid: 300, parentPid: 900, path: "D:\\Other\\DeepWrite.exe" }
    ];

    expect(foreignAppProcesses(rows, EXE, OWN).map((row) => row.pid)).toEqual([
      200
    ]);
  });

  it("stops walking a parent cycle", () => {
    const rows = [
      { pid: 200, parentPid: 201, path: EXE },
      { pid: 201, parentPid: 200, path: EXE }
    ];

    expect(foreignAppProcesses(rows, EXE, OWN)).toHaveLength(2);
  });
});
