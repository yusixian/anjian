# Storyboards

Use `storyboard` to plan and edit a product demo video. Keep the timeline and its media in `.anjian/artifacts/storyboard/<id>/`. Write `timeline.json` and place source files under `assets/`.

```json
{
  "title": "Product walkthrough",
  "tracks": [
    {
      "id": "picture",
      "name": "Picture",
      "kind": "video",
      "clips": [
        {
          "id": "opening",
          "asset": "assets/opening.mp4",
          "startMs": 0,
          "trimMs": 500,
          "durationMs": 4000
        }
      ]
    },
    {
      "id": "voice",
      "name": "Voice",
      "kind": "audio",
      "clips": [
        {
          "id": "intro",
          "asset": "assets/intro.wav",
          "startMs": 200,
          "trimMs": 0,
          "durationMs": 3500
        }
      ]
    }
  ],
  "version": 1
}
```

Use integer milliseconds. `startMs` places the clip in the timeline. `trimMs` sets its starting point in the source. `durationMs` is the amount to play. Leave unused images as files in the media bin or place them on a video track. Keep media filenames lowercase with letters, digits, and hyphens before the extension. Supported visual formats are MP4, WebM, PNG, and JPEG. Supported audio formats are WAV, MP3, and M4A.

Order video tracks from bottom to top. Clips on the same track can touch at a cut. Use different tracks for an overlap. Audio from video clips mixes with audio tracks. Black and silence fill intervals with no corresponding clip. Images hold for the clip's duration. The rendered MP4 uses 30 fps, so a cut between frames appears at the next frame. A storyboard supports up to eight tracks, 32 clips, five minutes, 256 media files, and 32 MiB of source files, with 24 MiB for a single media file.

If a video clip runs longer than its source, the rendered picture holds the final frame through the end of the clip. Audio ends at the source's audio boundary. Set the trim start within the source.

Keep the clip ID when moving, stretching, or changing its asset. Reread the latest timeline before writing. For a self-hosted project, pull first and push the complete timeline and its source assets so the revision check protects a newer edit.

Set `project` to the project directory. Use Start to open the editor or receive the private link. Use Check to read source warnings.

```bash
anjian start --json --project-dir "$project" --artifact storyboard/product-demo
anjian check --json --project-dir "$project" --artifact storyboard/product-demo
anjian comment list --all --json --project-dir "$project" --artifact storyboard/product-demo
```

Match each review's `anchor.clipId` against the timeline. Use `--clip "$clip"` for a new review and its returned thread ID for replies.

```bash
anjian comment add --json --project-dir "$project" --artifact storyboard/product-demo --clip "$clip" --text "Tighten this cut."
anjian comment reply --json --project-dir "$project" --artifact storyboard/product-demo --thread "$thread" --text "Shortened the opening."
```

Open the storyboard and choose **Render video** or **Save and render**. Play the completed preview with sound, then download the MP4 from that same render. If rendering fails, inspect the error, correct the source or timing as needed, and retry. When you make another edit, render the new revision before handing off a video. Download important revisions to keep them. A storyboard retains the four latest completed renders. Send a downloaded MP4 to a recipient who needs to watch it outside the project.
