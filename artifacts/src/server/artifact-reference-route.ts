import fs from 'node:fs';
import type http from 'node:http';
import path from 'node:path';

import { type ArtifactReference, validateArtifactReference } from '../shared/artifact-reference';
import { resolveReferenceFocus } from '../shared/reference-focus';
import { SLIDE_DECK_FILE } from '../shared/slides';
import { STORYBOARD_FILE } from '../shared/storyboard';
import { ARTIFACT_TYPES, type ArtifactType } from '../shared/types';
import { WHITEBOARD_SCENE_FILE } from '../shared/whiteboard';
import type { MountedProject } from './app';
import type { IndexedArtifact } from './artifact-index';
import { findTrashedArtifact } from './artifact-trash';
import { readArtifactSource, titleOf } from './context';
import { send, sendJson } from './http';
import { artifactsRootOf } from './machine';
import { withProjectMutation } from './project-mutations';

const apiTypes = ARTIFACT_TYPES.join('|');
const API = new RegExp(`^/api/artifact-reference/(${apiTypes})/([^/]+)$`);
const VIEW = new RegExp(`^/(${apiTypes})/([^/]+)/?$`);
const PRIMARY: Record<ArtifactType, string> = {
  document: 'doc.xml',
  html: 'index.html',
  artboard: 'canvas.json',
  slides: SLIDE_DECK_FILE,
  storyboard: STORYBOARD_FILE,
  whiteboard: WHITEBOARD_SCENE_FILE,
};

function referenceFrom(url: URL, match: RegExpExecArray): ArtifactReference | null {
  const board = url.searchParams.getAll('board');
  const group = url.searchParams.getAll('group');
  if (board.length + group.length > 1) return null;
  try {
    const focus = board.length
      ? { kind: 'board' as const, id: board[0]! }
      : group.length
        ? { kind: 'group' as const, id: group[0]! }
        : undefined;
    const reference: ArtifactReference = {
      type: match[1] as ArtifactType,
      target: decodeURIComponent(match[2]!),
      ...(focus ? { focus } : {}),
    };
    validateArtifactReference(reference);
    return reference;
  } catch {
    return null;
  }
}

interface Options {
  list: () => IndexedArtifact[];
  mount: (project: string) => Promise<MountedProject>;
  visible: (req: http.IncomingMessage, url: URL, project: string) => boolean;
}

export function createArtifactReferenceRoute({ list, visible, mount }: Options) {
  return async (req: http.IncomingMessage, res: http.ServerResponse, url: URL) => {
    const api = API.exec(url.pathname);
    const match = api ?? (url.searchParams.get('ref') === '1' ? VIEW.exec(url.pathname) : null);
    if (!match) return false;
    res.setHeader('Cache-Control', 'no-store');
    const unavailable = () => {
      if (api) sendJson(res, 404, { code: 'reference_unavailable' });
      else send(res, 404, 'Artifact reference unavailable');
    };
    if (req.method !== 'GET') {
      send(res, 405, 'Method not allowed');
      return true;
    }
    const reference = referenceFrom(url, match);
    if (!reference) {
      unavailable();
      return true;
    }
    const { type, target, focus } = reference;
    const matches = list().filter((entry) => entry.type === type && entry.address === target);
    const candidate = matches.length === 1 ? matches[0] : undefined;
    if (!candidate || !visible(req, url, candidate.project)) {
      unavailable();
      return true;
    }
    const { id, project } = candidate;
    const dir = path.join(artifactsRootOf(project), type, id);
    const current = () => {
      if (!visible(req, url, project) || findTrashedArtifact(project, type, target, 'address'))
        return false;
      try {
        const address = path.join(dir, '.artifact-id');
        return (
          fs.lstatSync(dir).isDirectory() &&
          fs.lstatSync(address).isFile() &&
          fs.readFileSync(address, 'utf8').trim() === target &&
          fs.lstatSync(path.join(dir, PRIMARY[type])).isFile()
        );
      } catch {
        return false;
      }
    };
    await withProjectMutation(project, async () => {
      if (!current()) return unavailable();
      const payload = readArtifactSource(dir, { type, id });
      if (
        focus &&
        (!('canvas' in payload) ||
          !payload.canvas ||
          !payload.layout ||
          !resolveReferenceFocus(payload.canvas, payload.layout, focus))
      )
        return unavailable();
      const canvas = 'canvas' in payload ? payload.canvas : null;
      const group = focus?.kind === 'group' ? canvas?.groups?.[focus.id] : undefined;
      const board = focus?.kind === 'board' ? canvas?.boards[focus.id] : undefined;
      const mounted = !api || (group && group.verify) ? await mount(project) : null;
      if (!current()) return unavailable();
      if (!api) {
        await mounted!.handleRequest(req, res);
        return;
      }
      const query = new URLSearchParams({ ref: '1' });
      if (focus) query.set(focus.kind, focus.id);
      const review = mounted && focus ? mounted.referenceVerdict(id, focus.id) : undefined;
      const title = group?.title ?? board?.title;
      sendJson(res, 200, {
        href: `/${type}/${target}?${query}`,
        title: (typeof title === 'string' && title.trim()) || titleOf(payload),
        ...(review ? { review } : {}),
      });
    });
    return true;
  };
}
