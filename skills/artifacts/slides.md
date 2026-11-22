# Slide decks

Use `slides` for a talk, walkthrough, or other live presentation that needs an ordered deck. The editor can change the text, reorder slides, and save speaker notes. Viewers can navigate by stable slide ID.

Write `deck.json` under `.anjian/artifacts/slides/<id>/`. Order the `slides` array in presentation order. Each slide has a unique lowercase ID of letters, digits and hyphens. Keep IDs when editing or moving slides. Use plain text for all fields.

```json
{
  "slides": [
    {
      "id": "opening",
      "title": "Launch briefing",
      "body": "What ships this week",
      "notes": "Ask each lead for a status update."
    },
    {
      "id": "timeline",
      "title": "Timeline",
      "body": "Pilot on Monday\nRollout on Wednesday",
      "notes": ""
    }
  ],
  "title": "Launch briefing",
  "version": 1
}
```

Reread the latest deck before saving a revision and preserve edits made by the human. For a self-hosted deck, pull before editing and use push to check the whole-deck revision. The viewer's Present action opens the audience view. Open the presenter window from there to control the deck while privately viewing your notes and the next slide.

Set `project` to the project directory. Start the deck to get its private link and subscribe the current supported Agent session to human reviews.

```bash
anjian start --json --project-dir "$project" --artifact slides/launch-briefing
anjian check --json --project-dir "$project" --artifact slides/launch-briefing
anjian comment list --json --project-dir "$project" --artifact slides/launch-briefing
```

The returned comments identify the slide by `anchor.slideId`. Match that ID to the deck even if the order changed. Reply with the returned thread ID. Use `--slide "$slide"` when adding a new thread.

```bash
anjian comment add --json --project-dir "$project" --artifact slides/launch-briefing --slide "$slide" --text "Check rollout timing."
anjian comment reply --json --project-dir "$project" --artifact slides/launch-briefing --thread "$thread" --text "Updated the rollout timing."
```

For an authorized reviewer, use the private deck link with `?slide=timeline` to open that slide. If the human wants an anonymous link, save your edits, open Share, publish a snapshot, and give the recipient the generated public link. The snapshot contains slide titles and bodies. Speaker notes and review threads stay private. A later edit stays private until someone republishes it.
