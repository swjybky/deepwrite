import config from "../../electron.vite.config.ts";

// Reuse the app build configuration while isolating this test's dev server
// from any existing renderer that reconnects to the usual development port.
export default {
  ...config,
  renderer: {
    ...config.renderer,
    plugins: [
      ...config.renderer.plugins,
      {
        name: "shutdown-smoke-pending-workspace",
        configureServer(server) {
          console.log(
            `DEEPWRITE_SHUTDOWN_SMOKE ${JSON.stringify({ type: "dev-group", pid: process.pid })}`
          );
          let delayed = false;
          server.middlewares.use((request, _response, next) => {
            if (
              process.env.DEEPWRITE_SHUTDOWN_SMOKE_SCENARIO === "startup" &&
              !delayed &&
              request.url?.split("?")[0] === "/src/WorkspaceShell.vue"
            ) {
              delayed = true;
              console.log('DEEPWRITE_SHUTDOWN_SMOKE {"type":"module-pending"}');
              setTimeout(next, 3_000);
            } else next();
          });
        }
      }
    ],
    server: {
      port: Number(process.env.DEEPWRITE_SHUTDOWN_SMOKE_PORT),
      strictPort: true
    }
  }
};
