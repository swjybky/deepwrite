import { beforeEach, describe, expect, it, vi } from "vitest";

const { run, readFile } = vi.hoisted(() => ({
  run: vi.fn(),
  readFile: vi.fn()
}));
vi.mock("node:child_process", () => ({ execFile: vi.fn() }));
vi.mock("node:util", () => ({ promisify: () => run }));
vi.mock("node:fs/promises", () => ({ readFile }));

import { readFeedbackDeviceModel } from "./device-model";

beforeEach(() => {
  vi.resetAllMocks();
});

describe("feedback device model", () => {
  it("reads only the Mac hardware model with a bounded command", async () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("darwin");
    run.mockResolvedValue({ stdout: " MacBookPro18,3\n" });
    expect(await readFeedbackDeviceModel()).toBe("MacBookPro18,3");
    expect(run).toHaveBeenCalledWith("/usr/sbin/sysctl", ["-n", "hw.model"], {
      timeout: 3_000,
      maxBuffer: 16 * 1024,
      windowsHide: true
    });
  });

  it("uses CIM for Windows manufacturer and model", async () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("win32");
    run.mockResolvedValue({ stdout: "Example  Notebook\r\n" });
    expect(await readFeedbackDeviceModel()).toBe("Example Notebook");
    expect(run.mock.calls[0]?.[0]).toBe("powershell.exe");
    expect(run.mock.calls[0]?.[1].join(" ")).toContain(
      "Get-CimInstance Win32_ComputerSystem"
    );
    expect(run.mock.calls[0]?.[1].join(" ")).not.toContain("SerialNumber");
  });

  it("reads Linux product metadata", async () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("linux");
    readFile
      .mockResolvedValueOnce("Example\n")
      .mockResolvedValueOnce("Notebook\n");
    expect(await readFeedbackDeviceModel()).toBe("Example Notebook");
  });

  it("allows feedback after unavailable hardware or command timeout", async () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("win32");
    run.mockRejectedValue(new Error("timeout"));
    expect(await readFeedbackDeviceModel()).toBe("");
  });

  it("bounds model length to the server limit", async () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("darwin");
    run.mockResolvedValue({ stdout: "型".repeat(129) });
    expect(await readFeedbackDeviceModel()).toHaveLength(128);
  });
});
