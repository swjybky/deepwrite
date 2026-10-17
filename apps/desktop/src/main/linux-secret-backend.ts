import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { join } from "node:path";

const BACKENDS = [
  "gnome-libsecret",
  "kwallet",
  "kwallet5",
  "kwallet6"
] as const;
type Backend = (typeof BACKENDS)[number];
interface CommandLine {
  hasSwitch(name: string): boolean;
  appendSwitch(name: string, value: string): void;
}
interface Services {
  running: Set<string>;
  activatable: Set<string>;
}
const WALLET_SERVICES: [Backend, string][] = [
  ["kwallet6", "org.kde.kwalletd6"],
  ["kwallet5", "org.kde.kwalletd5"],
  ["kwallet", "org.kde.kwalletd"]
];

function serviceNames(method: string): Set<string> {
  // Query only service names, never collections, items or secret values.
  // dbus-send is optional: retain Electron's defaults if it is unavailable.
  const commands: [string, string[]][] = [
    [
      "dbus-send",
      [
        "--session",
        "--print-reply",
        "--reply-timeout=600",
        "--dest=org.freedesktop.DBus",
        "/org/freedesktop/DBus",
        `org.freedesktop.DBus.${method}`
      ]
    ],
    [
      "busctl",
      [
        "--user",
        "--timeout=600ms",
        "call",
        "org.freedesktop.DBus",
        "/org/freedesktop/DBus",
        "org.freedesktop.DBus",
        method
      ]
    ]
  ];
  for (const [command, args] of commands) {
    const result = spawnSync(command, args, {
      encoding: "utf8",
      timeout: 800,
      maxBuffer: 128 * 1024
    });
    if ((result.error as NodeJS.ErrnoException | undefined)?.code === "ENOENT")
      continue;
    if (result.error || result.status !== 0) return new Set();
    return new Set(
      [...result.stdout.matchAll(/"([a-zA-Z0-9_.-]+)"/gu)].map((m) => m[1]!)
    );
  }
  return new Set();
}

export function selectLinuxSecretBackend(
  { running, activatable }: Services,
  environment: NodeJS.ProcessEnv
): Backend | undefined {
  const available = new Set([...running, ...activatable]);
  const desktop =
    `${environment.XDG_CURRENT_DESKTOP ?? ""}:${environment.XDG_SESSION_DESKTOP ?? ""}`.toLowerCase();
  const wallet = (names: Set<string>) =>
    WALLET_SERVICES.find(([, name]) => names.has(name))?.[0];
  // Preserve KDE's native preference when both providers are installed.
  if (desktop.split(":").some((name) => /^(kde|plasma)/u.test(name))) {
    const version = environment.KDE_SESSION_VERSION;
    const preferred = WALLET_SERVICES.find(
      ([backend, name]) =>
        backend === `kwallet${version === "4" ? "" : version}` &&
        available.has(name)
    )?.[0];
    if (preferred) return preferred;
    const backend = wallet(running) ?? wallet(available);
    if (backend) return backend;
  }
  if (available.has("org.freedesktop.secrets")) return "gnome-libsecret";
  return wallet(running) ?? wallet(available);
}

function preferencePath(userDataPath: string): string {
  return join(userDataPath, "config", "linux-secret-backend.json");
}

export function configureLinuxSecretBackend(
  commandLine: CommandLine,
  userDataPath: string,
  options: {
    platform?: string;
    environment?: NodeJS.ProcessEnv;
    services?: () => Services;
  } = {}
): void {
  if (
    (options.platform ?? process.platform) !== "linux" ||
    commandLine.hasSwitch("password-store")
  )
    return;
  let saved: unknown;
  try {
    saved = JSON.parse(readFileSync(preferencePath(userDataPath), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      // A corrupt/unreadable preference must not silently select another keyring.
      throw new Error(
        "Cannot read the Linux secret storage backend preference."
      );
    }
  }
  if (saved !== undefined) {
    if (!BACKENDS.includes(saved as Backend))
      throw new Error("Invalid Linux secret storage backend preference.");
    commandLine.appendSwitch("password-store", saved as Backend);
    return;
  }
  const services = options.services?.() ?? {
    running: serviceNames("ListNames"),
    activatable: serviceNames("ListActivatableNames")
  };
  const backend = selectLinuxSecretBackend(
    services,
    options.environment ?? process.env
  );
  if (backend) commandLine.appendSwitch("password-store", backend);
}

/** Called after ready and before credential stores open, only for a usable backend. */
export function rememberLinuxSecretBackend(
  userDataPath: string,
  selected: string
): void {
  const backend = selected === "gnome_libsecret" ? "gnome-libsecret" : selected;
  if (!BACKENDS.includes(backend as Backend)) return;
  const directory = join(userDataPath, "config");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const target = preferencePath(userDataPath);
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, JSON.stringify(backend) + "\n", {
      mode: 0o600,
      flag: "wx",
      flush: true
    });
    renameSync(temporary, target);
  } finally {
    rmSync(temporary, { force: true });
  }
}
