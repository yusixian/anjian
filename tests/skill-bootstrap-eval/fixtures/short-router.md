---
name: using-anjian
description: Use when choosing a Anjian workflow for a task.
---

# Anjian workflows

Load the matching skill for the task's current stage:

- New features or behavior changes: `anjian:brainstorming` before implementation.
- Approved designs ready to implement or resume: `anjian:executing-specs`.
- Bugs or unexpected behavior: `anjian:systematic-debugging` before fixing.
- Implementation: `anjian:test-driven-development`.
- Visible UI changed: `anjian:verifying-ui` before reporting completion.
- Visual comparisons, mockups or shared design documents: `anjian:artifacts`.

When your human partner says to skip discussion and code, proceed under TDD.
Ordinary questions and read-only checks can be answered directly.
Use project-specific skills at their relevant step and honor your human
partner's explicit instructions.

Before claiming a fix, passing checks or completion, run the relevant
verification in this session and report what it showed.
