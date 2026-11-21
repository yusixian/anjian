export interface DocumentQuestion {
  approve?: string;
  id: string;
  options?: { id: string; label: string }[];
  prompt: string;
  recommended?: string;
}

export function sameDocumentQuestion(left: DocumentQuestion, right: DocumentQuestion): boolean {
  return (
    left.id === right.id &&
    left.approve === right.approve &&
    left.prompt === right.prompt &&
    left.recommended === right.recommended &&
    left.options?.length === right.options?.length &&
    (left.options?.every((option, index) => {
      const other = right.options?.[index];
      return option.id === other?.id && option.label === other.label;
    }) ??
      true)
  );
}

const QUESTION_ID = /^[A-Z0-9][\w-]{0,63}$/i;
const MAX_PROMPT_LENGTH = 2000;
const MAX_OPTION_LENGTH = 500;
const MAX_OPTIONS = 20;

function validId(value: unknown): value is string {
  return typeof value === 'string' && QUESTION_ID.test(value);
}

function validText(value: unknown, limit: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= limit;
}

export function validateDocumentQuestion(value: DocumentQuestion): void {
  if (!value || !validId(value.id))
    throw new Error(
      '<ask> key must contain 1–64 letters, digits, hyphens or underscores and start with a letter or digit',
    );
  if (!validText(value.prompt, MAX_PROMPT_LENGTH))
    throw new Error('<ask> prompt must contain 1–2000 characters');
  const options = value.options;
  if (options !== undefined) {
    if (!Array.isArray(options) || options.length < 2 || options.length > MAX_OPTIONS)
      throw new Error('<ask> options must contain 2–20 choices');
    const ids = new Set<string>();
    for (const option of options) {
      if (!option || !validId(option.id) || !validText(option.label, MAX_OPTION_LENGTH))
        throw new Error('<ask> each option needs a valid id and a label of 1–500 characters');
      if (ids.has(option.id)) throw new Error(`<ask> duplicate option id "${option.id}"`);
      ids.add(option.id);
    }
  }
  if (value.approve !== undefined) {
    if (!options?.some((option) => option.id === value.approve))
      throw new Error('<ask> approve must match an option id');
    if (value.recommended !== undefined)
      throw new Error('<ask> approval cannot specify recommended');
  }
  if (
    value.recommended !== undefined &&
    !options?.some((option) => option.id === value.recommended)
  )
    throw new Error('<ask> recommended must match an option id');
}
