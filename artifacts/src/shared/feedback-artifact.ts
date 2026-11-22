export const FEEDBACK_ARTIFACT_TYPES = [
  'document',
  'artboard',
  'whiteboard',
  'slides',
  'storyboard',
] as const;

export type FeedbackArtifactType = (typeof FEEDBACK_ARTIFACT_TYPES)[number];

export function isFeedbackArtifactType(value: unknown): value is FeedbackArtifactType {
  return (
    typeof value === 'string' && (FEEDBACK_ARTIFACT_TYPES as readonly string[]).includes(value)
  );
}
