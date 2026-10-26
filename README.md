# DeepWrite

**English** · [中文](./README.zh-CN.md) · [Download](https://github.com/swjybky/deepwrite/releases)

> A source-available, local-first AI writing agent workbench for creators.

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

Models added through the official site entry send `X-DeepWrite-Session-ID`, keeping the same ID across turns, retries, and tool continuations and using a new ID for each new conversation. This lets the gateway keep the same source and account. Free models and custom connections do not automatically receive this header, even when they use the same endpoint or provider name.

## Installation and Setup

### Use an installer

Go to [GitHub Releases](https://github.com/swjybky/deepwrite/releases) and download the test installer matching your OS and processor:

| Platform | Installer |
| --- | --- |
| Windows x64 | `DeepWrite-<version>-win-x64-test.exe` |
| macOS Apple Silicon | `DeepWrite-<version>-mac-arm64-test.dmg` |
| macOS Intel | `DeepWrite-<version>-mac-x64-test.dmg` |

On Windows, run the `.exe` and follow the installer.

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
- Windows x64, or macOS Apple Silicon / Intel

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
pnpm pack:test:linux       # Linux x64: AppImage, DEB, RPM, Arch
pnpm pack:test:win         # Windows x64
pnpm pack:test:mac:arm64   # macOS Apple Silicon
pnpm pack:test:mac:x64     # macOS Intel
pnpm pack:test:mac         # Both macOS architectures
```

Artifacts are written to `apps/desktop/release/`. The packaging flow runs the full verification suite and a production build before generating and validating installers.

Linux builds use the same `pnpm pack:test:linux` entry for every format. Ubuntu/Debian build hosts need `rpm`, `rpm2cpio`, `libarchive-tools`, and `zstd` in addition to the desktop runtime dependencies; Arch build hosts need `rpm-tools`, `libarchive`, and `zstd`. The workflow installs these tools automatically. RPM and Arch packages include the bundled Electron runtime and declare `libsecret` as a dependency.

For a downloaded local package, use `sudo dnf install ./DeepWrite-<version>-linux-x86_64-test.rpm` on Fedora/RHEL or `sudo pacman -U ./DeepWrite-<version>-linux-x64-test.pkg.tar.zst` on Arch. This produces a local Arch package, not an AUR submission. Package validation checks architecture, launcher, required runtime files, and that the RPM/Arch ASAR bytes match the app used for first-launch and reopen checks.

### Automatic Releases from Tags

The `Build and publish tagged release` workflow runs when a `v*` tag is pushed: push the tag → build and verify every platform → upload assets to a draft → publish the complete GitHub Release. The tag must use `vMAJOR.MINOR.PATCH` and match both package versions. Ordinary branch pushes and publishing a Release do not trigger packaging.

1. First push `.github/workflows/release.yml` and its supporting scripts to `main`. The tagged source must also contain these files.
2. Set the root and `apps/desktop/package.json` versions to the same target version, then commit and push. For example, version `1.6.6` in both files requires tag `v1.6.6`.
3. Create and push that tag with `git tag v1.6.6` followed by `git push origin v1.6.6`. There is no need to create a Release manually.
4. Follow **Actions → Build and publish tagged release**. Once every platform passes, installers, blockmaps, update manifests, and `SHA256SUMS.txt` are uploaded to a draft and verified before the Release becomes public.

Native runners build Windows x64 EXE, macOS Apple Silicon and Intel DMG / ZIP, and Linux x64 AppImage / DEB / RPM / Arch (`.pkg.tar.zst`) packages. Each runs the existing `pnpm pack:test:*` flow, including full verification, production builds, and packaged first-launch and reopen checks. macOS also verifies DMGs, ad-hoc signatures, and ZIP integrity. The publish job checks sizes and SHA-512 hashes and merges both architectures into `latest-mac.yml`. Actions artifacts are retained for 14 days.

Only the publish job receives `contents: write` through the repository-provided `GITHUB_TOKEN`; builds remain read-only. Enable Actions and allow the actions used by this workflow. Windows packages remain unsigned; macOS uses ad-hoc signing without Apple notarization.

Use **Re-run failed jobs** on the original run to reuse successful platform artifacts and resume its upload draft. Existing matching assets are skipped; empty incomplete uploads are removed and retried only in that run's private draft. Conflicting files, public releases, and drafts belonging to another run are preserved. Failed uploads keep the draft private. If a tag has no run, choose `main` in **Run workflow** and enter the existing tag; all builds use its tagged commit. Release notes are generated automatically. GitHub selects Latest by semantic version, so an older build finishing later does not replace a newer release.

If all four platform jobs pass and only publication fails, open **Actions → Build and publish tagged release → Run workflow** on `main`, enter the same tag, and set `reuse_run_id` to the original run ID. Recovery checks the source commit, successful platform verification, and complete unexpired artifacts before resuming the original draft. It uses publication tools from the selected workflow revision while keeping the tag pinned to the installer source; installers are not rebuilt.

New builds retain a `release-source-<commit>` artifact named with the checked-out installer source, so manually building an older tag from `main` can also be recovered. Older tag-push runs remain recoverable through their matching tag and commit. Historical manual runs without a source record must be rebuilt once; their triggering branch commit cannot prove the installer source. If a source record is present, mismatched, conflicting, empty, or expired records are rejected.

In-app updates still use the root `update.json`. Update it through the existing release-manifest process after the Release is public and every installer has been uploaded successfully; this workflow does not advance it early.

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

DeepWrite is **source-available**. New project material offered by its copyright holders under the [PolyForm Perimeter License 1.0.1](./LICENSE) is subject to its noncompete terms.

- **Personal writing income is allowed**: use DeepWrite to write and sell novels, accept paid writing commissions, publish books, and earn royalties. This software license does not require you to publish your manuscripts or share your writing income.
- **Learning and modifications for your own use are allowed**: study the source code and customize DeepWrite for your own writing. Noncompeting internal business use is also permitted.
- **Competing software and services require separate permission**: you may not use code covered by this license to offer competing software, websites, or services to others without separate authorization from the relevant copyright holders. This includes rebranding the code as a competing paid app or offering its writing functionality through a competing hosted service. The restriction also applies to competing products offered free of charge.

These examples summarize the license; the unmodified English text in [LICENSE](./LICENSE) governs. Its competition restrictions do not meet the [OSI Open Source Definition](https://opensource.org/osd), so the project is described as source-available.

**Earlier licenses and third-party material**: code and releases already made available under Apache License 2.0 retain those existing permissions. Pre-existing third-party contributions and dependencies retain their original licenses unless their copyright holders separately authorize a change. See [NOTICE](./NOTICE) and the preserved [Apache License 2.0](./LICENSES/Apache-2.0.txt) for the license scope and prior contributor attribution.
