import type { Plugin } from "vite";

/** Electron receives the same terminal interrupt and owns save-before-exit. */
export function keepDevServerUntilElectronExits(): Plugin {
  return {
    name: "deepwrite-dev-shutdown",
    apply: "serve",
    configureServer(server) {
      const httpServer = server.httpServer;
      if (!httpServer) return;
      const keepServing = () => {};
      const listen = () => process.on("SIGINT", keepServing);
      // Before listen, electron-vite is still starting and has no Electron
      // child to finish shutdown. Preserve normal interruption during builds.
      httpServer.once("listening", listen);
      httpServer.once("close", () => {
        httpServer.removeListener("listening", listen);
        process.removeListener("SIGINT", keepServing);
      });
      // electron-vite exits when its Electron child closes. Until then, keep
      // serving even after repeated Ctrl+C so pending imports and saves finish.
    }
  };
}
