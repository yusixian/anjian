import type { CommentsFile, HumanOp } from '../../shared/comments';
import { DOCUMENT_FEATURES, DOCUMENT_FEATURES_HEADER } from '../../shared/document-features';
import type { DocumentPayload } from '../../shared/types';
import type { Channel } from './channel';

export interface DocumentMeta extends DocumentPayload {
  contentBase: string;
}

export interface DocumentState {
  agentActiveAt?: number;
  comments?: CommentsFile;
  lineage: string;
  now?: number;
  snapshot: string;
  streaming?: boolean;
}

export interface DocumentTransport {
  artifact: string;
  channel: Channel;
  comment: (op: HumanOp) => Promise<CommentsFile>;
  meta: () => Promise<DocumentMeta | null>;
  send: (message: unknown) => void;
  state: () => Promise<DocumentState>;
  update: (bytes: Uint8Array) => Promise<void>;
}

export const encodeBase64 = (bytes: Uint8Array) => {
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
};

export function createLocalTransport({
  id,
  channel,
  send,
}: {
  id: string;
  channel: Channel;
  send: (message: unknown) => void;
}): DocumentTransport {
  const post = (action: string, body: BodyInit, type: string) =>
    fetch(`/api/document/${id}/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': type, [DOCUMENT_FEATURES_HEADER]: DOCUMENT_FEATURES.join(',') },
      body,
    });
  return {
    artifact: `document/${id}`,
    channel,
    send,
    async meta() {
      const res = await fetch(`/api/artifacts/document/${id}`, { cache: 'no-store' });
      return res.ok ? ((await res.json()) as DocumentMeta) : null;
    },
    async state() {
      const res = await fetch(`/api/document/${id}/state`, { cache: 'no-store' });
      const state = (await res.json()) as Partial<DocumentState> & { error?: string };
      if (!res.ok || !state.snapshot) throw new Error(state.error ?? `load failed (${res.status})`);
      return state as DocumentState;
    },
    async update(bytes) {
      const res = await post(
        'update',
        bytes as Uint8Array<ArrayBuffer>,
        'application/octet-stream',
      );
      if (!res.ok) throw new Error(`update failed (${res.status})`);
    },
    async comment(op) {
      const res = await post('comments', JSON.stringify(op), 'application/json');
      if (!res.ok) throw new Error(`comment failed (${res.status})`);
      return ((await res.json()) as { comments: CommentsFile }).comments;
    },
  };
}
