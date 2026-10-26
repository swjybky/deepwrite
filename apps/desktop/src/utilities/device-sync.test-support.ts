import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { FolderCatalogStore } from "./folder-catalog-store";
import { LongWorkspaceService } from "./long-workspace-service";
import { DesktopSyncWorkspace } from "./device-sync-workspace";
import {
  MemoryDav,
  device
} from "../extras/device-sync/engine/sync-test-support";

interface Workspace {
  root: string;
  userDataPath: string;
  catalog: FolderCatalogStore;
  longs: LongWorkspaceService;
}

export function desktopSyncTestClient(
  name: string,
  dav: MemoryDav,
  f: Workspace
) {
  const client = device(name, dav);
  const desktop = new DesktopSyncWorkspace(
    f.userDataPath,
    async () => f.catalog,
    f.longs
  );
  client.options.workspace = {
    list: () => desktop.list(),
    validate: (item) => desktop.validate(item),
    recover: () => desktop.recover(),
    apply: (key, expected, next) => desktop.apply(key, expected, next, f.root)
  };
  return { ...client, desktop };
}

export async function desktopSyncTestPeer(root: string, dav: MemoryDav) {
  await mkdir(root, { recursive: true });
  const userDataPath = join(root, "user-data");
  const catalog = new FolderCatalogStore({ userDataPath });
  const longs = new LongWorkspaceService({ userDataPath });
  const f = { root, userDataPath, catalog, longs };
  return { ...f, client: desktopSyncTestClient("receiver", dav, f) };
}
