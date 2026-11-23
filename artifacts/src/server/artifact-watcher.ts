import type { ServerMessage } from '../shared/types';
import {
  artifactKeyOf,
  type ArtifactRef,
  artifactSignature,
  resolveArtifactDir,
} from './artifacts';
import type { ServerContext } from './context';
import { slidesCommentsOf } from './slides-comments';
import { storyboardCommentsOf } from './storyboard-comments';
import { watchTree } from './watch';
import { whiteboardCommentsOf } from './whiteboard';
import { textFrame } from './ws';

const watchedComments = {
  slides: slidesCommentsOf,
  storyboard: storyboardCommentsOf,
  whiteboard: whiteboardCommentsOf,
};

export function watchArtifacts(
  ctx: ServerContext,
  commentFileChanged?: (artifact: string) => void,
  libraryChanged?: () => void,
) {
  const { root, signatures, clients, documents, boardComments, runtimeWarnings } = ctx;
  const pending = new Set<string>();
  const key = {};
  return watchTree(
    root,
    (files) => {
      for (const file of files) pending.add(file);
      ctx.inputs.run(key, () => {
        const files = [...pending];
        pending.clear();
        libraryChanged?.();
        const byArtifact = new Map<string, { ref: ArtifactRef; files: string[] }>();
        for (const file of files) {
          const ref = artifactKeyOf(file);
          if (!ref) continue;
          const key = `${ref.type}/${ref.id}`;
          const entry = byArtifact.get(key) ?? { ref, files: [] };
          const inner = file.slice(key.length + 1);
          if (inner) entry.files.push(inner);
          byArtifact.set(key, entry);
        }
        for (const [key, { ref, files: changed }] of byArtifact) {
          const dir = resolveArtifactDir(root, ref.type, ref.id);
          if (!dir) {
            if (ref.type === 'artboard') ctx.selections.refreshArtboard(ref.id);
            signatures.delete(key);
            runtimeWarnings.delete(key);
            const frame = textFrame(
              JSON.stringify({
                type: 'change',
                artifact: key,
                files: changed,
              } satisfies ServerMessage),
            );
            for (const socket of clients) socket.write(frame);
            continue;
          }
          if (ref.type === 'document' && (changed.includes('doc.xml') || changed.length === 0))
            documents.fileChanged(ref.id);
          if (ref.type === 'document' && changed.includes('comments.json'))
            documents.commentsChanged(ref.id);
          if (
            changed.includes('comments.json') &&
            (ref.type === 'slides' || ref.type === 'storyboard' || ref.type === 'whiteboard')
          ) {
            const commentsOf = watchedComments[ref.type];
            ctx.backgroundWrites.enqueue(`comments/${key}`, (admit) => {
              const current = resolveArtifactDir(root, ref.type, ref.id);
              if (current === dir) commentsOf(ctx, dir).sync(admit);
            });
          }
          if (ref.type === 'artboard')
            ctx.backgroundWrites.enqueue(`artboard/${ref.id}`, (admit) => {
              boardComments.sync(ref.id, admit);
              boardComments.boardsChanged(ref.id, admit);
              if (changed.includes('canvas.json')) commentFileChanged?.(key);
            });
          if (changed.includes('comments.json')) commentFileChanged?.(key);
          const signature = artifactSignature(dir, ref.type);
          if (signatures.get(key) === signature) continue;
          const reported = runtimeWarnings.get(key);
          if (reported?.initialSignature === signature) delete reported.initialSignature;
          else runtimeWarnings.delete(key);
          const payload = ctx.refreshState(ref, dir);
          const message = { type: 'change', artifact: key, files: changed } satisfies ServerMessage;
          if (ref.type === 'whiteboard') ctx.broadcast(message);
          else {
            const frame = textFrame(JSON.stringify(message));
            for (const socket of clients) socket.write(frame);
          }
          ctx.changeListeners.forEach((listener) => listener(ref, payload, changed));
        }
        ctx.touch();
      });
    },
    ctx.options.debounceMs,
  );
}
