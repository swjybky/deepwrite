import { app, session } from "electron";
import {
  applyNodeHttpProxyEnv,
  captureNodeHttpProxyEnv,
  type CapturedNodeHttpProxyEnv
} from "./disable-node-http-proxy-env";

const capturedProxyEnv: CapturedNodeHttpProxyEnv = captureNodeHttpProxyEnv();
let proxyUpdate = Promise.resolve();
let requestedMode: "system" | "direct" | undefined;

export function applyNetworkProxyPreference(enabled: boolean): void {
  applyNodeHttpProxyEnv(enabled, capturedProxyEnv);
  if (!app.isReady()) return;
  const mode = enabled ? "system" : "direct";
  if (requestedMode === mode) return;
  requestedMode = mode;
  const update = proxyUpdate
    .catch(() => undefined)
    .then(async () => {
      await session.defaultSession.setProxy({ mode });
      // Pooled sockets may otherwise keep using the previous proxy configuration.
      await session.defaultSession.closeAllConnections();
    });
  proxyUpdate = update;
  void update.catch(() => {
    if (proxyUpdate === update) requestedMode = undefined;
  });
}

export function waitForNetworkProxyPreference(): Promise<void> {
  return proxyUpdate;
}
