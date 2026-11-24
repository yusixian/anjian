<div align="center">

# Anjian · 案间

**An open-source visual workbench for you and your AI Agent**

Artboards · Documents · HTML Previews · Whiteboards · Slide Decks · Storyboards · Local-first & Self-hosted

[Documentation](https://anjian.cosine.ren/en/) · [中文 README](README.md) · [Release Notes](https://anjian.cosine.ren/en/docs/updates) · [GitHub Releases](https://github.com/yusixian/anjian/releases)

</div>

---

## What is Anjian?

Iterating on designs, specs, or prototypes inside a chat box gets messy fast—you end up taking screenshots and describing where every button sits.

**Anjian** puts the **artboards, documents, HTML pages, whiteboards, slide decks, and storyboards** your Agent creates right in the browser. Click the exact spot you want changed, leave a comment, and let your Agent pull your notes via CLI, edit the source files, push the next version, and reply in place.

## Features

- **Artboards**: Lay out multi-page designs side by side with pan/zoom, layer & style inspection, pinned comments, option voting, sign-off checklists, phone mockups, and interactive prototypes.
- **Documents**: Rich-text specs with inline comments, direct copy editing, block-level artifact references, Q&A/approval cards, verification reports, and revision diffs.
- **HTML Previews**: Run full HTML prototypes in an isolated sandbox and send selected text straight to your Agent.
- **Whiteboards, Slide Decks & Storyboards**: Sketch flows, present slides with speaker notes, and render storyboards to MP4.
- **Broad Agent Support**: Bundled Skill (`anjian skills get artifacts`) for Claude Code, Codex (including planning tasks & approvals), Pi, Antigravity, GitHub Copilot CLI, DeepSeek Harness, and custom hosts.
- **Public Sharing & Friend Workspaces**: Publish read-only snapshot links with no sign-in required, or invite friends via GitHub to their own isolated workspace.
- **Local-First & Self-Hosted**: Prebuilt macOS & Linux packages, or deploy with Docker Compose / Dokploy with shared quotas and S3 storage.

> No cloud account, no subscription, and no upstream auto-updater. Your artifacts stay on your machine or your own server.

---

## Quick Start

### 1. Run locally (fastest: download a release package)

Download the archive for your OS from [GitHub Releases](https://github.com/yusixian/anjian/releases) (Node.js bundled; macOS Apple Silicon / Intel and Linux x64 / arm64), verify SHA-256, unpack, and run:

```bash
./anjian start --project-dir /abs/path/to/your-project --no-open --foreground
```

Or build from source (requires Git, Node.js 22, and pnpm):

```bash
git clone https://github.com/yusixian/anjian.git
cd anjian/artifacts
pnpm install --frozen-lockfile
pnpm build
node dist/cli.cjs start --project-dir /abs/path/to/your-project --no-open --foreground
```

Open the full URL printed in the terminal. See the [Local Setup guide](https://anjian.cosine.ren/en/docs/local) for details.

### 2. Self-host with Docker

Requires two HTTPS domains (main workbench on `27319` + isolated preview on `27329`):

```bash
export ANJIAN_PUBLIC_ORIGIN=https://anjian.example.com
export ANJIAN_BOARD_ORIGIN=https://preview.example.net
docker compose up --build -d
```

See the [Self-Hosting guide](https://anjian.cosine.ren/en/docs/self-hosting) for reverse proxy, Dokploy, and GitHub sign-in setup.

### 3. Pair local CLI & Agent

```bash
# Inspect bundled skills and check current link
anjian skills get artifacts
anjian remote status --json

# Pair with a remote server and link a local project
anjian login https://your-anjian-domain --name "My Laptop"
anjian link
anjian push --artifact html/hello
```

See [Connect an Agent](https://anjian.cosine.ren/en/docs/agent) and [Devices & CLI](https://anjian.cosine.ren/en/docs/remote-cli) for full instructions.

---

## Credits & Licensing

Anjian is forked from [Innei/ryugi v1.51.2](https://github.com/Innei/ryugi/tree/v1.51.2) (commit `6054b65ab9b2208a234a78632eb065cfeb3eb166`) and maintained independently. Thanks to Innei and the Ryugi contributors, as well as Jesse Vincent and the [Superpowers](https://github.com/obra/superpowers) contributors. Full attribution is preserved in [UPSTREAM.md](UPSTREAM.md).

- **Skills, integrations & docs**: [MIT License](LICENSE)
- **`artifacts/` app & build artifacts**: [AGPL-3.0-only](artifacts/LICENSE)
- **Third-party dependencies**: Respective open-source licenses

Renaming does not change inherited licenses. If you run a modified version as a network service for others, follow the AGPL-3.0 source-availability requirement.
