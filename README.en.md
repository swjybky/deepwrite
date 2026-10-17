# DeepWrite

[English](./README.en.md) · [中文](./README.md) · [Download](https://github.com/swjybky/deepwrite/releases)

> A local-first AI writing agent workbench for creators.

DeepWrite brings models, prompts, writing skills, reference materials, manuscripts, and tools together in one desktop app. Agents can understand the context of your current work, help develop characters, plots, outlines, and prose, edit real documents through controlled tools, and hand every change to you for review.

![DeepWrite main workspace: resource tree on the left, agent chat in the middle, and content editor on the right](./docs/images/workspace-overview.png)

## Highlights

- **Three-pane writing workspace**: manage projects and context, collaborate with agents, and edit real content in one view.
- **Workflow-specific agents**: organize distinct responsibilities around characters, plots, outlines, manuscripts, and section writing.
- **Reviewable manuscript edits**: inspect every diff before it is saved, preventing silent overwrites by agents.
- **Local-first data**: store works as `deepwrite.json` and UTF-8 Markdown files that remain usable with Git, sync drives, and other text tools.
- **Bring your own models**: add your preferred model services and switch models or thinking levels by agent or task.
- **Material libraries, skill libraries, and sub-agents**: bind the right context and capabilities to each work, or assemble teams for complex tasks.
- **Book and writing analysis**: analyze short and long books, learn from revisions, and compare writing styles, saving the results as reusable materials or skills.

## How It Works

### Keep the whole writing process in view

Inspired by the Codex workflow, DeepWrite uses a clear three-pane layout for the surfaces you use most:

- Left: works, chapters, material libraries, skill libraries, and common actions
- Middle: agent chat, reasoning, tool execution, and edit suggestions
- Right: characters, plots, outlines, manuscripts, materials, or skill content

When you switch between writing stages or chapters, DeepWrite switches to the matching agent and context. Browsing materials and skills does not interrupt the current manuscript, and chapters can be opened quickly in separate tabs.

![Agent-assisted writing and manuscript editing](./docs/images/agent-manuscript.png)

### Work with specialized writing agents

Short-form creation includes several agents with focused responsibilities:

- Character Agent: design characters, relationships, motivations, and character arcs
- Plot Agent: plan the main storyline, opening hooks, conflicts, turns, and endings
- Outline Agent: turn characters and plot into an executable section outline
- Manuscript Expert: oversee structure, review drafts, and polish the final text
- Section Writer: write around the current chapter while keeping plot, characters, and voice consistent

Each agent can have its own system prompt, welcome shortcuts, and model. Short-form and screenplay agents can also have configurable resource access. Long-form stages share access to settings, plot, manuscript, and continuity records while retaining per-agent controls for readable material and skill types. Main agents can also lead sub-agent teams.

### Review before writing to disk

Agents never silently replace your text. Each write first produces a diff so you can inspect additions and deletions, then accept or reject the proposal. Only accepted changes are saved locally. If another operation has already updated the manuscript, DeepWrite preserves the newer version instead of overwriting it.

![Agent edit diff with accept and reject actions](./docs/images/edit-diff.png)

### Manage local works and knowledge bases

DeepWrite supports:

- Creating or opening local works
- Managing characters, plots, outlines, and multiple manuscript sections
- Creating material and skill libraries with Markdown entries
- Binding selected libraries, skills, or resource groups to a work
- Importing legacy book ZIP archives into the current folder structure
- Restoring unsaved drafts and recent agent sessions automatically

Your data stays in open local file formats instead of being locked inside the app.

### Bring your own models

You can add your own API services in Model Settings. DeepWrite currently supports:

- OpenAI Completions
- OpenAI Responses
- Anthropic Messages
- Google Generative AI

Model keys are never exposed to the renderer. Each model can have a default thinking level, and you can switch models by task during a conversation.

## Installation and Setup

### Use an installer

Go to [GitHub Releases](https://github.com/swjybky/deepwrite/releases) and download the test installer matching your OS and processor:

| Platform | Installer |
| --- | --- |
| Windows x64 | `DeepWrite-<version>-win-x64-test.exe` |
| Windows ARM64 | `DeepWrite-<version>-win-arm64-test.exe` |
| macOS Apple Silicon | `DeepWrite-<version>-mac-arm64-test.dmg` |
| macOS Intel | `DeepWrite-<version>-mac-x64-test.dmg` |
| Linux x64 | `DeepWrite-<version>-linux-x64-test.AppImage` / `.deb` |
| Linux ARM64 | `DeepWrite-<version>-linux-arm64-test.AppImage` / `.deb` |
| Arch Linux / CachyOS x64 | `DeepWrite-<version>-linux-x64-test.pkg.tar.xz` |
| Arch Linux / CachyOS ARM64 | `DeepWrite-<version>-linux-aarch64-test.pkg.tar.xz` |

On Windows, run the `.exe` and follow the installer.

On Arch Linux, CachyOS, and other Arch-based distributions, install the local package with `sudo pacman -U ./DeepWrite-<version>-linux-x64-test.pkg.tar.xz`. Electron is bundled. Saving model keys requires a running, unlocked system keyring such as GNOME Keyring or KWallet; the app selects the backend automatically.

On macOS, open the `.dmg` and drag DeepWrite into Applications. Current test builds use ad-hoc signing and are not notarized by Apple. Downloads received through a browser, WeChat, or similar channels may trigger a macOS security warning. Confirm that you trust the source, then right-click the app and choose Open, or allow it under System Settings → Privacy & Security.

After the first launch:

1. Choose a local workspace directory.
2. Add an API service in Model Settings and test the connection.
3. Create a work, or open an existing DeepWrite project folder.
4. Create and bind material or skill libraries as needed.

### Run from source

Requirements:

- Node.js 24 or later
- pnpm 11 or later
- Windows x64, Linux x64, or macOS Apple Silicon / Intel

```bash
git clone https://github.com/swjybky/deepwrite.git
cd deepwrite
pnpm install
pnpm dev
```

Common development commands:

```bash
pnpm dev       # Start the desktop development environment
pnpm build     # Build the production app
pnpm verify    # Run formatting, type, boundary, test, and build checks
```

## Build Test Installers

Test installers must be built on their target platform from the repository root:

```bash
pnpm pack:test             # All test packages supported by the current host
pnpm pack:test:arch        # Arch Linux / CachyOS x64
pnpm pack:test:linux       # Linux x64: AppImage, deb, and Arch package
pnpm pack:test:linux:arm64 # Linux ARM64: AppImage, deb, and Arch package
pnpm pack:test:win         # Windows x64
pnpm pack:test:win:arm64   # Windows ARM64
pnpm pack:test:mac:arm64   # macOS Apple Silicon
pnpm pack:test:mac:x64     # macOS Intel
pnpm pack:test:mac         # Both macOS architectures
```

Artifacts are written to `apps/desktop/release/`. The packaging flow runs the full verification suite and a production build before generating and validating installers.

### Automatic releases from tags

Commit and push the workflow and related changes, set both the root and desktop `package.json` versions to the intended release, then push the matching `vMAJOR.MINOR.PATCH` tag (for example, `v1.6.6` when both versions are `1.6.6`).

The `Build and publish tagged release` workflow builds and verifies Windows x64 / ARM64, macOS ARM64 / Intel, and Linux x64 / ARM64 installers (AppImage, deb, Arch) on native runners. After every platform succeeds, it checks asset sizes and SHA-512 hashes, merges the two macOS update manifests, writes the ARM64 update manifests, uploads all assets to a draft, and publishes the GitHub Release. Failed uploads remain in the current run's draft and can resume when the workflow is rerun. Existing published releases are preserved.

If a tag exists without a workflow run, open this workflow in Actions, choose `Run workflow` on `main`, and enter the existing tag (for example, `v1.6.6`). Recovery checks out that tag and validates its versions without deleting or moving it. For an existing failed run, use `Re-run jobs` to resume uploads to the same draft.

CI uses free standard runners: four test workers on x64 and ARM64 Linux and Windows and on Intel Mac, and three on ARM Mac, with Node heap limits of 6 GiB and 4 GiB respectively. pnpm, Electron, and packaging downloads use caches separated by OS, architecture, and dependency locks. Desktop build and smoke checks run before the full test suite, and a platform failure cancels the remaining jobs. Packaging retains full verification plus first-launch and reopen checks inside the packaged app.

Actions artifacts are retained for 14 days. Publishing uses the repository's `GITHUB_TOKEN` without additional release credentials. Windows builds remain unsigned and macOS builds use the existing ad-hoc signing configuration. Maintain the application's `update.json` through the existing release-manifest process.

## Project Structure

```text
deepwrite/
├── apps/desktop/              # Electron desktop client
├── packages/contracts/        # Cross-process command and event contracts
├── packages/pi-runtime-adapter/
│                              # Agent Runtime adapter
├── packages/shared/           # Shared types and utilities
├── tools/                     # Verification, runtime, and packaging scripts
└── docs/images/               # README and project documentation images
```

DeepWrite uses a multi-process Electron architecture: the Renderer handles the UI, Main manages windows and secure IPC, the Core Utility handles local project I/O, the Agent Utility runs models and agents, and the Tool Utility provides a bounded surface for controlled tool execution.

## License

DeepWrite is open source under the [Apache License 2.0](./LICENSE).
