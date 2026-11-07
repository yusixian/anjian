---
name: artifacts
description: Use when seeing decides faster than reading — UI directions or mockups to choose between, a page to tune or click through, a design doc, review, proposal, or architecture walkthrough for them or their team to read — or when they ask for an artifact or artboard by name, or for a link to share one. Inside brainstorming or anywhere else
---

# Artifacts

Artifacts are pages your human partner opens in their browser while you
work: an artboard of mockups to choose from and comment on, a document to
read and comment on, or one HTML page to click and tune. You write files into the project; a local server shows each
artifact at its own link and updates it the moment a file changes. They look,
then answer in the terminal.

## Local workspace

Use the Anjian workbench built from this repository. It has no hosted account,
cloud publishing, subscription, or automatic upstream package download.
Do not switch to a hosted artifacts tool to work around a missing local build.

If the launcher reports that its build is missing, run `pnpm install --frozen-lockfile`
and `pnpm build` in this repository's `artifacts/` directory, then retry the launcher.
Do not install `ryugi-artifacts` or an unverified `anjian` npm package.

## Pick the type

| What is being decided                                                            | Type                       | Read before writing                                                      |
| -------------------------------------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------ |
| Architecture, engineering design, a review, proposal or flow walkthrough         | `document`                 | `document.md`                                                            |
| One surface or one dimension — a component, type scale, background, motion       | `html`                     | `html.md`, `ui.md` for components                                        |
| A business space — several screens, dimensions, states or questions at once      | `artboard`                 | `artboard.md`; `artboard-prototype.md` for playable boards or parameters |
| Whether a built change matches what was approved, when they ask you to verify it | `artboard`, a verify group | `artboard.md`                                                            |
| Nothing to see                                                                   | text                       |                                                                          |

A control does not make it an artboard: one surface, however tunable, is
`html`. The artboard is for several dimensions at once; one group is one
dimension. "HTML" or "page" names the medium, not the type.

## Before writing

The type column is a gate, not a menu: open that doc first, in a command of
its own. Read alongside other files, a harness's output cap can cut it off
midway. `html` also reads
`ui.md` — its controls are `<anjian-…>`; artboard boards use plain HTML, CSS
and JavaScript, including their own event handlers. Verify against the doc —
ids, `anjian-change`, restored state — not just that it renders.

For board-level controls, `artboard-prototype.md` documents `data-anjian-tweaks`: a JSON
declaration creates a Parameters panel beside its board. Use it for a few
intentional levers; the board consumes typed values through CSS and JS.

## Creative work

Load the project's design system (tokens, components, type) before the first
frame; if it has none, say which type, scale and palette you are using. Use
real copy and data, never lorem ipsum.

For preview icons, read [icons.md](./icons.md). When implementing the
approved design, map its actions to the app's existing business icons;
the preview glyphs are visual references.

`html` is one surface: both themes when the product has them, and the states
the decision touches; a control tunes one dimension.

`artboard` is the space of a requirement: one group per question, its
variants differing in that one dimension; everything else stays still.

`document` is where architecture and engineering decisions are argued, with
diagrams and code — not a gallery of screens.

## Pick the artifact

Each artifact is `<project>/.anjian/artifacts/<type>/<id>/`. The id is
lowercase letters, digits and hyphens, named after the topic
(`arrow-tuner`, `header-nav`).

- Same topic: keep the same artifact and change it in place.
- New topic: a new id, and so a new link.
- Your human partner can override either.

## Start the server and get the link

Paths below are relative to this skill's directory: resolve `app/` to its
absolute path before you run them. Every artifacts command goes through the
launcher `app/anjian.cjs` with `--json`; it runs this repository's local build.
A background start returns one JSON startup result; foreground mode stays running.

```bash
node app/anjian.cjs start --json --project-dir /path/to/project --artifact html/arrow-tuner
# {"type":"server-started","url":"http://localhost:27319/","port":27319,
#  "root":"/path/to/project/.anjian/artifacts","link":"http://localhost:27319/html/<artifact-id>"}
```

- Give them `link` exactly as printed; `url` opens the artifact library.
- Run `start` before you write a new artifact's first file, so the page is
  open while you write it.
- Run it again only right before a message that gives a link, with the
  artifact you're about to mention; edits in between need no `start`. It
  prints `"reused": true` while the server is up, and otherwise starts it on
  the same port, so open tabs reconnect.
- One server serves every project on this machine and keeps running
  between sessions. Every run registers your project with it.
- The browser opens when the first artifact is ready enough: for an artboard,
  once its focus group is complete (or two boards when there are no groups),
  even while later boards are still drawing. Pass `--no-open` only for
  headless or scripted use. Still share the link; remote setups can't
  auto-open. Read `artboard.md` for the streaming write order.
- Stop it with `node app/anjian.cjs stop --json`.
  It stops the server for every project; the artifacts stay.

**Launching by harness.** The server must survive across turns.

- Claude Code: run the command as is; it backgrounds the server, on
  Windows too.
- Codex: run it as is. With the server already running it returns at
  once. Otherwise it detects `CODEX_CI` and stays in the foreground: give
  it its own tool call with a yield of at least 5 seconds. When it starts a new server it does not return, so
  anything chained after it with `;` or `&&` runs only once the server
  stops.
- OMP (oh-my-pi): run it as is. OMP cuts output lines longer than 768
  bytes, so pipe `comment list --json` and `check --json` through `jq .`.
  Don't pipe `start`.
- Gemini CLI, Copilot CLI and others that reap detached processes: add
  `--foreground` and start it with the harness's background-shell mechanism.

**Remote or containerized setups:** if the link is unreachable from their
browser, bind a non-loopback host and name the host they reach it by:
`--host 0.0.0.0 --url-host <reachable-host>`. A server bound that way refuses
requests without its key: its `link` carries `?key=`, so give it to them
complete.

## Access from another device

Anjian does not publish copies to an official cloud. A link works only while the
user-controlled server is running and reachable from that device. Do not promise
that a localhost link works on a phone or that a stopped server has a hosted copy.

For a user-authorized LAN setup, bind `--host 0.0.0.0` and use the machine's reachable
LAN address with `--url-host`. Keep the printed access key. The HTML/artboard preview
origin also needs to be reachable. For an HTTPS deployment, follow the repository's
self-hosting instructions; remote content synchronization and Agent notification
must be verified separately from merely opening the web page.

Do not suggest Cloud login, `publish`, `get`, `config --auto-publish`, or subscription
upgrades: those commands are not part of Anjian. If a user supplies an old Ryugi Cloud
link, explain that importing it requires an exported local artifact; do not ask for
their official Cloud credentials.

## Directory

```
<project>/.anjian/artifacts/
  artboard/<id>/       canvas.json + pages/ (you write); comments.json (server only)
  document/<id>/       doc.xml + assets/ (you write); comments.json (server only)
  html/<id>/           index.html + its files        (you write)
  .state/              the server writes; never edit
    <type>/<id>/warnings.json   warnings + pending; `check` prints it
    artboard/<id>/layout.json   computed geometry
```

- Keep each artifact self-contained: everything it uses lives inside its
  own directory and is referenced relatively. Copy screenshots in; never
  point at absolute paths.
- `.state/` keeps itself out of git. By default `.anjian/.gitignore` keeps
  only documents in git; changing that is your human partner's call: leave
  `.gitignore` alone.

## After every change

1. Write the files with your file-writing tool.
2. Run `check` after your last write. It waits until the server has checked
   that write, then prints `warnings` (and `pending` for an artboard); no
   sleep or `checkedAt` comparison is needed.

   ```bash
   node app/anjian.cjs check --json --project-dir /path/to/project --artifact artboard/settings-nav
   # {"type":"checked","artifact":"artboard/settings-nav","checkedAt":"…","warnings":[],"pending":[]}
   ```

   Fix every warning. For `html` this includes `runtime: …` lines: errors
   the page threw in their browser. They only count once `"ran": true`
   shows the new version has loaded there; until then, an empty list
   means "not run yet", not "no errors".

3. Tell them what changed, give the link, and ask for their answer in the
   terminal. For a document, an `html` page or static boards, send that
   message as soon as `check` is clean; screenshots or browser checks of
   your own come after it, reported in the next message. Playable boards
   follow `artboard.md`.

When the conversation moves on, leave the artifact as it is; it's the
record of what was explored.
