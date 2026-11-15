import { execFile } from "node:child_process";
import { basename } from "node:path";
import { app, dialog, type BrowserWindow } from "electron";
import { nativeMessages, nativeText } from "./native-i18n";

export interface AppProcess {
  pid: number;
  parentPid: number;
  path: string;
}

/** Lines of "pid<TAB>parent pid<TAB>executable path"; others are skipped. */
export function parseAppProcesses(output: string): AppProcess[] {
  return output.split(/\r?\n/).flatMap((line) => {
    const [pid, parentPid, path] = line.split("\t");
    const row = { pid: Number(pid), parentPid: Number(parentPid), path };
    return Number.isInteger(row.pid) && row.pid > 0 && path?.trim()
      ? [{ ...row, path: path.trim() }]
      : [];
  });
}

/**
 * Processes running this binary outside this app's own process tree, such as
 * MCP bridges an external agent client started. They hold the files an update
 * must replace.
 */
export function foreignAppProcesses(
  rows: readonly AppProcess[],
  execPath: string,
  ownPid: number
): AppProcess[] {
  const parents = new Map(rows.map((row) => [row.pid, row.parentPid]));
  const inOwnTree = (pid: number): boolean => {
    let current = pid;
    for (let depth = 0; depth < 32; depth += 1) {
      if (current === ownPid) return true;
      const parent = parents.get(current);
      if (parent === undefined || parent === current) return false;
      current = parent;
    }
    return false;
  };
  const target = execPath.toLowerCase();
  return rows.filter(
    (row) => row.path.toLowerCase() === target && !inOwnTree(row.pid)
  );
}

/** Empty when the list cannot be read: the installer still checks files. */
function listAppProcesses(execPath: string): Promise<AppProcess[]> {
  const name = basename(execPath);
  if (!/^[\w .-]+$/.test(name)) return Promise.resolve([]);
  const script = `Get-CimInstance Win32_Process -Filter "Name = '${name}'" | ForEach-Object { "$($_.ProcessId)\`t$($_.ParentProcessId)\`t$($_.ExecutablePath)" }`;
  return new Promise((resolve) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { windowsHide: true, timeout: 10_000 },
      (error, stdout) => resolve(error ? [] : parseAppProcesses(stdout))
    );
  });
}

function showWarning(
  window: BrowserWindow | undefined,
  options: Electron.MessageBoxOptions
): Promise<Electron.MessageBoxReturnValue> {
  return window && !window.isDestroyed()
    ? dialog.showMessageBox(window, options)
    : dialog.showMessageBox(options);
}

/** Windows cannot replace a binary that another process is running. */
export async function confirmUpdateInstall(
  window: BrowserWindow | undefined
): Promise<boolean> {
  if (process.platform !== "win32") return true;
  const count = foreignAppProcesses(
    await listAppProcesses(process.execPath),
    process.execPath,
    process.pid
  ).length;
  if (count === 0) return true;
  const { response } = await showWarning(window, {
    type: "warning",
    title: nativeText("updateFilesInUse"),
    message: nativeText("updateFilesInUse"),
    detail: nativeMessages().updateFilesInUseDetail(count),
    buttons: [nativeText("installAnyway"), nativeText("cancel")],
    defaultId: 1,
    cancelId: 1,
    noLink: true
  });
  return response === 0;
}

export function showFailedUpdateNotice(
  window: BrowserWindow | undefined,
  expectedVersion: string
): void {
  void showWarning(window, {
    type: "warning",
    title: nativeText("updateNotInstalled"),
    message: nativeText("updateNotInstalled"),
    detail: nativeMessages().updateNotInstalledDetail(
      expectedVersion,
      app.getVersion()
    )
  });
}
