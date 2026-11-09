# Self-hosted Anjian: Agent operations

Use for HTTPS artifact upload/download and browser comments on a user-controlled
server. Commands below apply to the built Anjian CLI, not the removed Ryugi Cloud.

## Find the entry point

1. Read the current workspace/project `AGENTS.md`. If it names a wrapper, use its
   exact path; it may already fix the project directory and private client home.
   Confirm with `remote status --json`. Preserve the user's existing binding.
2. Without a wrapper, resolve this skill's `app/anjian.cjs` and the user's artifact
   project to absolute paths. Do not infer that the Anjian source checkout is that
   project. The examples use this shell function (replace both paths):

   ```bash
   anjian() {
     node /absolute/anjian/skills/artifacts/app/anjian.cjs "$@" \
       --project-dir /absolute/artifact-project --json
   }
   anjian remote status
   ```

   If a private `ANJIAN_CLIENT_HOME` is configured, retain it for every command.
   Otherwise the CLI uses `~/.anjian/client/`. Status prints metadata, not tokens.
3. If no binding/credential exists, use the authorized server origin and run
   `anjian login https://your-server --name "Agent device" --no-open`, then
   `anjian link --server https://your-server`. For multiple projects, select the
   intended ID with `--project <id>` from the returned list; do not guess a path.

Keep the login process alive while approval is pending. Open its printed URL and
approve only the intended projects in an administrator-authenticated browser.
If the page asks for an access key, first open the owner's existing full access
link in that browser. When authorized to administer the deployment, the container's
`/data/server/key` supplies that key for the standard Docker setup; otherwise ask
the owner to log in. Do not paste keys into chat. A pairing code does not log the
browser in. Expired pairing requires a new login attempt; success precedes link.

## Process a document or artboard comment

Use the same entry point and project for every step. Read the corresponding type
reference before editing. Existing artifact example:

```bash
anjian remote status
anjian comment list --artifact document/plan --all
anjian pull --artifact document/plan
# Read the freshly pulled doc.xml; edit only the requested blocks, preserving IDs.
anjian push --artifact document/plan
anjian check --artifact document/plan
anjian comment reply --artifact document/plan --thread <thread-id> --text "已修改并上传，检查通过。"
```

Inspect each result before proceeding. If pull refuses local changes, preserve and
compare them. `pull --backup-local` writes a private base64 file manifest backup
before replacing source; read that backup and merge the intended edits afterward.
This flag is permission to replace after backup, not automatic merging. A push
conflict requires a new pull/compare/merge; there is no force-upload shortcut.
A nonzero push with `localChangedDuringUpload` or `localSyncFailed` means the server
may have accepted the upload but local reconciliation is incomplete: follow its
recovery message before reporting success. Never reply "fixed" before push and
check succeed. Resolve a thread when requested or clearly authorized as settled.

For a genuinely new artifact, write a complete valid source tree and push once;
if that ID already exists, pull and reconcile. Files live under the selected
project's `.anjian/artifacts/<type>/<id>/`. Remote writes are explicit snapshots,
not live local file watching. Artboards must include every referenced board file
before pushing; the local skeleton streaming workflow cannot be uploaded halfway.
Return the successful push's `url`. A recipient still needs browser access.

Comments apply to document/artboard; HTML uses push/pull/check and browser runtime
verification. Upload only source/resources. Server comments, history and CRDT state
remain server-owned. Do not edit/copy comments.json or .state to simulate a reply.

## Events, errors and credentials

| Situation | Next action |
| --- | --- |
| Read existing feedback | `comment list --artifact <type>/<id> --all`; new sessions should not assume an unread cursor is fresh |
| Observe new changes | `watch --json` in a supported persistent process, or `watch --once --json` for one batch |
| Event received | Fetch current comments or pull source; events contain metadata, not the full thread |
| First watch / expired cursor | First watch starts at now. Read current comments before `watch --reset`; do not claim historical events were replayed |
| Duplicate event / resync | Deduplicate by event ID; on resync read current full state |
| 401 / expired or revoked device | Stop writes and obtain device approval again; recheck binding |
| 403 / project inaccessible | Verify granted project scope; do not replace it with a guessed project or admin key |
| 429 / temporary outage | Honor retry guidance; watch retries temporary failures, not permission failures |

`watch` does not wake an idle Lody/Codex/Claude session. No host scheduler or automatic
comment processing is implied by installing this Skill. Report that gap explicitly.

Credentials and bindings live in the private client home (directory 0700, file
0600), outside the project. Record paths in local project guidance, never token
contents or authenticated URLs. `logout <origin>` revokes the device and clears its
bindings; `unlink` only removes the current directory's binding. Do neither as
routine cleanup of a reusable user-authorized device. HTTPS is required off loopback.
