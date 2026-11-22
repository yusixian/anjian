# Phone mockups

Use the existing artboard format to compare mobile designs. Start a local review
with the actual project and artifact, using the project's CLI wrapper if present.

```bash
node app/anjian.cjs start --mockup --json --project-dir /path/to/project --artifact artboard/booking-review
```

For a remote project, read `remote.md` and use its review flow. This guide is
also available through `skills get artifacts --reference phone-mockups.md`.

## Set the screen and its safe areas

- Read `artboard.md` for the canvas, choice groups, and validation. Use the
  project's design specification, components, type, colors, and realistic content.
- Pick the requested device viewport in CSS pixels. For a 390 × 844 comparison,
  set each board to `w: 390, h: 844` in `canvas.json`. The board is the full
  screen, including any simulated system bars. Keep the device boundary clear
  at fit-to-screen zoom using the screen styling and the surrounding canvas.
- Choose top and bottom safe insets from the target or project guidance and
  record the values or assumptions in a canvas note. Set those insets explicitly
  in the mockup HTML. A preview frame on a desktop cannot supply the simulated
  phone's insets through CSS `env(safe-area-inset-*)`.
- Keep simulated system UI inside those reserved areas. Keep interactive content
  clear of them. When comparing a pinned bottom action, reserve its full height
  and the bottom inset so it cannot cover the last line of content.
- Keep the same device framing, insets, fixtures, and product state for both
  options. Use the canvas for titles, explanations, and selection. Keep them
  outside the phone viewport so reviewers see the actual screen footprint.

## Review

Put the options in the same choice group and focus the group. Keep its question
about one decision, such as confirming a booking change inline or from a pinned
bottom action. Use real booking details and identical action labels in both.
Run `check` for file readiness and layout warnings. Open the artboard at
desktop and phone widths and inspect both options at the declared screen size.
On a narrow phone, also check the viewer’s fit and option navigation. Check that
the last content and primary action are visible, and that a comment on one board
stays attached to that option. Share the actual artifact link.
