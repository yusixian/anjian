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

Read the latest file before editing, and reread it just before saving. Apply your changes to the latest version so that the human's edits to other shapes survive. If both of you changed the same shape, reconcile it before saving. Give each new element an ID unique within its page. Keep media inside the native `files` map. For a self-hosted project, pull before editing and use the remote push command so the revision check can protect a newer update.

To see a human's targets, read `anchor.page` and `anchor.elementIds` from the CLI output. An omitted page means `main`. Match the IDs to `elements[*].id` on that page. If an ID was deleted, mention it in the reply instead of guessing another target. Reply to the thread through the CLI. Set `project` to the project directory and `thread` to the returned thread ID.

```bash
anjian comment list --json --project-dir "$project" --artifact whiteboard/launch-sequence
anjian comment reply --json --project-dir "$project" --artifact whiteboard/launch-sequence --thread "$thread" --text "Updated the selected elements."
```

Use `comment add --elements <id1,id2>` to create an element discussion, with `--page <id>` on an extra page. The server owns `comments.json` and `.state/`. A public share is a read-only snapshot and omits review threads.

## Work with pages

The default page is always `main` and stays in `scene.excalidraw`. Additional pages are listed in `pages.json` and stored as native scenes at `pages/<id>.excalidraw`. Preserve page IDs when renaming titles. Read the manifest before editing and write a new scene file before listing it in the manifest.

```json
{
  "pages": [{ "id": "review", "title": "Review" }],
  "version": 1
}
```

To share a page, use `?page=review` on the canonical whiteboard link. Add `&frame=<encoded-frame-id>` to reach its frame. If two pages contain the same element ID, the page in the link or comment determines the target. An anonymous link can open only a page already in the published snapshot. If a page must stay unpublished, share its private link with authorized readers.

## Link to a frame

Save the frame first. Select it from the whiteboard's frame picker and use **Copy frame link**. An Agent can build the same link from the canonical whiteboard URL by setting the `frame` query parameter to the URL-encoded `id` of the saved, undeleted element with `type: "frame"`. Keep the element ID stable when renaming or moving the frame.

Share the frame link with teammates who already have access. Strip the `key` parameter and other session details from links you hand off. For a public link, publish the whiteboard and copy the frame link from the published snapshot. Frames added after publication appear there after republishing.
