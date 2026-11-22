# Editable whiteboards

Use `whiteboard` for a diagram or sketch whose shapes the human can move or edit. Open the artifact from the workbench or start it with `anjian start --json --project-dir <project> --artifact whiteboard/<id>`. Give the human the returned `link`.

The source is `.anjian/artifacts/whiteboard/<id>/scene.excalidraw`, a native Excalidraw JSON file with `type: "excalidraw"`, `version: 2` and `elements`. Preserve existing element IDs, scene settings and embedded files when editing. A new example scene can start with an empty array.

```json
{
  "appState": { "name": "Launch sequence" },
  "elements": [],
  "type": "excalidraw",
  "version": 2
}
```

Read the latest file before editing, and reread it just before saving. Apply your changes to the latest version so that the human's edits to other shapes survive. If both of you changed the same shape, reconcile it before saving. Give each new element a unique ID. Keep media inside the native `files` map. For a self-hosted project, pull before editing and use the remote push command so the revision check can protect a newer update.

To see a human's targets, read `anchor.elementIds` from the CLI output and match them to `elements[*].id`. If an ID was deleted, mention it in the reply instead of guessing another target. Reply to the thread through the CLI. Browser selection opens the same elements when the human revisits the discussion.

```bash
anjian comment list --json --project-dir whiteboard/launch-sequence < project > --artifact
anjian comment reply --json --project-dir whiteboard/launch-sequence --thread "Updated the selected elements." < project > --artifact < thread-id > --text
```

Use `comment add --elements <id1,id2>` to create a new element discussion. The server owns `comments.json` and `.state/`. A public share is a read-only scene snapshot and omits review threads.

## Link to a frame

Save the frame first. Select it from the whiteboard's frame picker and use **Copy frame link**. An Agent can build the same link from the canonical whiteboard URL by setting the `frame` query parameter to the URL-encoded `id` of the saved, undeleted element with `type: "frame"`. Keep the element ID stable when renaming or moving the frame.

Share the frame link with teammates who already have access. Strip the `key` parameter and other session details from links you hand off. For a public link, publish the whiteboard and copy the frame link from the published snapshot. Frames added after publication appear there after republishing.
