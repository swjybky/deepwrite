import { describe, expect, it } from "vitest";
import {
  applyNodeHttpProxyEnv,
  captureNodeHttpProxyEnv,
  disableNodeHttpProxyEnv,
  envWithoutNodeHttpProxy
} from "./disable-node-http-proxy-env";

describe("disableNodeHttpProxyEnv", () => {
  it("strips every Node HTTP/SOCKS proxy variable so requests go direct", () => {
    const env: NodeJS.ProcessEnv = {
      HTTP_PROXY: "http://127.0.0.1:17891",
      HTTPS_PROXY: "http://proxy.example.test:8080",
      ALL_PROXY: "socks5://127.0.0.1:17891",
      http_proxy: "http://127.0.0.1:17891",
      NODE_USE_ENV_PROXY: "1",
      NO_PROXY: "localhost",
      PATH: "/usr/bin"
    };

    expect(captureNodeHttpProxyEnv(env)).toEqual({
      HTTP_PROXY: "http://127.0.0.1:17891",
      HTTPS_PROXY: "http://proxy.example.test:8080",
      ALL_PROXY: "socks5://127.0.0.1:17891",
      http_proxy: "http://127.0.0.1:17891",
      NODE_USE_ENV_PROXY: "1"
    });
    expect(disableNodeHttpProxyEnv(env)).toEqual([
      "HTTP_PROXY",
      "HTTPS_PROXY",
      "ALL_PROXY",
      "http_proxy",
      "NODE_USE_ENV_PROXY"
    ]);
    expect(env).toEqual({
      NO_PROXY: "localhost",
      PATH: "/usr/bin"
    });
  });

  it("restores a captured proxy when the user enables network proxy", () => {
    const env: NodeJS.ProcessEnv = {
      HTTP_PROXY: "http://127.0.0.1:17891",
      PATH: "/usr/bin"
    };
    const captured = captureNodeHttpProxyEnv(env);
    applyNodeHttpProxyEnv(false, captured, env);
    expect(env.HTTP_PROXY).toBeUndefined();
    applyNodeHttpProxyEnv(true, captured, env);
    expect(env.HTTP_PROXY).toBe("http://127.0.0.1:17891");
  });

  it("copies process env for utility workers without proxy keys", () => {
    expect(
      envWithoutNodeHttpProxy({
        HTTPS_PROXY: "http://127.0.0.1:17891",
        DEEPWRITE_HOME: "/tmp/deepwrite-example"
      })
    ).toEqual({
      DEEPWRITE_HOME: "/tmp/deepwrite-example"
    });
  });
});
