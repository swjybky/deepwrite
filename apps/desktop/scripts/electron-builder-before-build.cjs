/**
 * electron-vite bundles every desktop runtime dependency into `out`.
 * Returning false prevents electron-builder from copying the same pnpm
 * production dependency tree into app.asar a second time.
 */
exports.beforeBuild = async function beforeBuild() {
  return false;
};
