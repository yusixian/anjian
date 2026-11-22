export const PREVIEW_SELECTION_TTL = 120_000;
export const PREVIEW_SELECTION_TEXT = 2_000;
export const PREVIEW_SELECTION_SELECTOR = 500;

export interface PreviewSelection {
  capturedAt: number;
  revision: number;
  selector: string;
  text: string;
}

export interface SelectionRecipient {
  host: 'claude' | 'codex';
  id: string;
  label: string;
}

export type SelectionDelivery = 'queued' | 'delivered' | 'expired';
