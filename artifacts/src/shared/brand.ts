export const ANJIAN_MARK_VIEWBOX = '0 0 64 64';

// Encode every character so React useId values remain safe, distinct SVG fragment IDs.
export function anjianMarkBody(id: string): string {
  const prefix = `anjian-${Array.from(id, (char) => char.codePointAt(0)!.toString(16)).join('-')}`;
  return `<defs><mask id="${prefix}-pin" maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64"><rect width="64" height="64" fill="#fff"/><path d="M18 47v-6.5a6.5 6.5 0 1 1 6.5 6.5H19a1 1 0 0 1-1-1Z" fill="#000"/></mask><mask id="${prefix}-back" maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64"><rect width="64" height="64" fill="#fff"/><rect x="16.5" y="13.5" width="31" height="37" rx="6.5" fill="#000"/></mask></defs><g mask="url(#${prefix}-pin)" fill="currentColor"><rect x="23" y="7" width="31" height="37" rx="6.5" opacity=".26" mask="url(#${prefix}-back)"/><rect x="16.5" y="13.5" width="31" height="37" rx="6.5" opacity=".55"/><rect x="10" y="20" width="31" height="37" rx="6.5"/></g>`;
}
