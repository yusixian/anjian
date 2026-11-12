# Self-hosted Anjian: Agent operations

Use for HTTPS artifact upload/download and browser comments on a user-controlled
server. Commands below apply to the built Anjian CLI, not the removed Ryugi Cloud.

## Find the entry point

1. Read the current workspace/project `AGENTS.md`. If it names a wrapper, use its
   exact path; it may already fix the project directory and private client home.
   Confirm with `remote status --json`. Preserve the user's existing binding.
2. Without a wrapper, use the already discovered CLI; if needed, check
   `command -v anjian`, then read `--help`, `skills get artifacts` and
   `skills get artifacts --reference remote.md`. The output identifies the current
   executable and lists allowed references. For a source installation only,
   resolve this skill's `app/anjian.cjs`. Set the user's artifact project explicitly;
   the Anjian source checkout is not automatically that project. The examples below
   use `anjian` to mean your discovered entry point with these options:

   ```bash
   anjian() {
     node /absolute/path/to/anjian.cjs "$@" \
       --project-dir /absolute/artifact-project --json
   }
   anjian remote status
   ```

   If a private `ANJIAN_CLIENT_HOME` is configured, retain it for every command.
   Otherwise the CLI uses `~/.anjian/client/`. Status prints metadata, not tokens.

3. If status confirms a valid binding, reuse it. If unbound but the intended server
   already has a valid device credential, try `anjian link --server https://your-server`
   and read back `anjian remote status`. If authorization is absent, expired or revoked,
   initiate `anjian login https://your-server --name "Agent device" --no-open` yourself.
   Keep that process alive in a supported persistent tool session until the user
   approves in their browser and the CLI reports success. Then run `link` and read
   back `remote status --json`; confirm the origin and project before operating.
   Ask only if the server origin is unknown or the target among returned projects
   is genuinely ambiguous. A unique project can be selected directly; use its
   returned ID with `--project <id>` when needed.

Give the user the login process's actual approval URL. Ask them to approve in a
browser signed in to their account, selecting all required available projects
they can grant and the existing artifact operations those grants permit. This
follows the preference for complete usable access within that account's authority;
the browser approval and server response determine the actual grant. The current
protocol submits only the device name at login and grants a `projects` list.
There is no `--scope all` or permission-level request parameter, and no new
administrator role to obtain. Reuse valid bindings; do not revoke or re-pair merely
to broaden access. If the page needs browser authentication, the user signs in
or opens their existing full access link there. Do not fetch a deployment key or
another project's credentials. A pairing code is not a browser login; keep pending
distinct from success. Expired pairing requires a new login attempt before link.

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
anjian comment reply --artifact document/plan --thread "已修改并上传，检查通过。" < thread-id > --text
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

| Situation                       | Next action                                                                                                           |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Read existing feedback          | `comment list --artifact <type>/<id> --all`; new sessions should not assume an unread cursor is fresh                 |
| Observe new changes             | `watch --json` in a supported persistent process, or `watch --once --json` for one batch                              |
| Event received                  | Fetch current comments or pull source; events contain metadata, not the full thread                                   |
| First watch / expired cursor    | First watch starts at now. Read current comments before `watch --reset`; do not claim historical events were replayed |
| Duplicate event / resync        | Deduplicate by event ID; on resync read current full state                                                            |
| 401 / expired or revoked device | Stop writes and obtain device approval again; recheck binding                                                         |
| 403 / project inaccessible      | Verify granted project scope; do not replace it with a guessed project or admin key                                   |
| 429 / temporary outage          | Honor retry guidance; watch retries temporary failures, not permission failures                                       |

`watch` does not wake an idle Lody/Codex/Claude session. No host scheduler or automatic
comment processing is implied by installing this Skill. Report that gap explicitly.

Credentials and bindings live in the private client home (directory 0700, file
0600), outside the project. Record paths in local project guidance, never token
contents or authenticated URLs. `logout <origin>` revokes the device and clears its
bindings; `unlink` only removes the current directory's binding. Do neither as
routine cleanup of a reusable user-authorized device. HTTPS is required off loopback.
