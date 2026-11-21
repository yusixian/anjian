---
name: verifying
description: Use to present evidence for several acceptance claims across CLI, APIs, data, deployments or screen behavior, or whenever a human must review evidence.
---

# Verify the claim

Test in the environment named by the claim. Record the build, environment and
capture time. For a small claim, put the exact command and result in the
reply. For several checks or a multi-step flow, make a verification report
that the reader can reopen. For visual work, use `anjian:verifying-ui` to
capture what a person needs to judge.

## Publish a report

Read `anjian:artifacts` and its document guide. Create a document and run the
project's actual check commands. Save each command's full UTF-8 output in a
file next to the report manifest. Capture plain text and inspect it before
including it in a document other people can open.

`anjian verify-report --digest ./api-output.txt` prints the digest of the
captured file. Record it after checking the actual result, with the command
and its capture time. A report can contain an empty array for any section.

```json
{
  "build": "tested commit or deployed build",
  "checks": [
    {
      "title": "The CLI stores and reloads its result",
      "command": "pnpm test test/example.test.ts",
      "capturedAt": "2026-11-22T03:40:00Z",
      "output": "api-output.txt",
      "sha256": "replace with the captured output's SHA-256 digest",
      "result": "pass"
    }
  ],
  "environment": "test host, versions, access and relevant settings",
  "gaps": [{ "title": "Windows", "reason": "No Windows device was available" }],
  "reviews": [
    {
      "title": "Review the proposal",
      "target": "ABCDEFGHIJKLMNOPQRSTU",
      "group": "proposal",
      "ask": "Does the layout still fit without hiding the primary action?",
      "capturedAt": "2026-11-22T03:45:00Z"
    }
  ],
  "title": "Release verification"
}
```

Use the stable artboard address and a verify-group ID. The review entry opens
the current evidence and shows the group's actual verdict to readers with
access. When reviewers need to revisit a previous capture, leave its group
intact and put new evidence in a separate group. Public snapshots show the
reference label. Share the target separately when readers need access to it.

Create the document directory, generate its `doc.xml`, then run `anjian check` on the
document. Use the intended reader's browser access to verify the report,
open a raw output disclosure and follow the review links. For self-hosted
delivery, follow the artifact skill's remote workflow to upload the document.

```sh
anjian verify-report --input ./verification/report.json \
  --output .anjian/artifacts/document/release-verification/doc.xml
anjian check --artifact document/release-verification --json
```

## When evidence changes

- Generate and publish again before relying on the current results. A report
  shows the capture it was built from. Regeneration marks a check **待复核**
  if the source digest changes or the file is missing. Keep its previous
  digest until you rerun the check and assess the new output.
- Machine checks with a matching digest carry the full captured output in the
  document. Generate a new document revision after a rerun so readers can
  reopen the old report in history.
- An artboard verdict covers its evidence at the time of review. Replacing the
  group's evidence returns an existing verdict to **待验收** and marks the
  evidence updated. Leave the decision to the human reviewer and read its
  current verdict before reporting the result.
- Keep unavailable scenarios in the gaps section with the specific reason.
