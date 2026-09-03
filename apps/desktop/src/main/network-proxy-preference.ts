import { app, session } from "electron";
import {
  applyNodeHttpProxyEnv,
  captureNodeHttpProxyEnv,
  type CapturedNodeHttpProxyEnv
} from "./disable-node-http-proxy-env";

const capturedProxyEnv: CapturedNodeHttpProxyEnv = captureNodeHttpProxyEnv();

export function applyNetworkProxyPreference(enabled: boolean): void {
  applyNodeHttpProxyEnv(enabled, capturedProxyEnv);
  if (!app.isReady()) return;
  void session.defaultSession.setProxy({
    mode: enabled ? "system" : "direct"
  });
}
