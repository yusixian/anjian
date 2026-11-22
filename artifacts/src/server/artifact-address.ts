import fs from 'node:fs';
import path from 'node:path';

import { mintArtifactId } from '../shared/ids';
import type { ArtifactType } from '../shared/types';
import {
  isArtifactAddress,
  isArtifactId,
  isArtifactType,
  listArtifacts,
  resolveArtifactDir,
} from './artifacts';

class InvalidArtifactId extends Error {}

function readArtifactId(file: string): string | undefined {
  let id: string;
  try {
    id = fs.readFileSync(file, 'utf8').trim();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  if (!isArtifactAddress(id)) throw new InvalidArtifactId(`Invalid artifact ID in ${file}`);
  return id;
}

function artifactId(dir: string): string {
  const file = path.join(dir, '.artifact-id');
  const existing = readArtifactId(file);
  if (existing) return existing;
  const id = mintArtifactId();
  try {
    fs.writeFileSync(file, `${id}\n`, { flag: 'wx' });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    return artifactId(dir);
  }
  return id;
}

export function artifactPath(root: string, type: ArtifactType, slug: string): string {
  if (!isArtifactType(type) || !isArtifactId(slug)) throw new Error('Invalid artifact locator');
  const dir = path.join(root, type, slug);
  // start reserves a link before the agent writes the first content file.
  fs.mkdirSync(dir, { recursive: true });
  return `/${type}/${artifactId(dir)}`;
}

export function resolveArtifactAddress(
  root: string,
  type: ArtifactType,
  address: string,
  { mintMissing = true } = {},
) {
  let invalidSlug: InvalidArtifactId | undefined;
  const matches = listArtifacts(root).artifacts.filter((entry) => {
    if (entry.type !== type) return false;
    try {
      const id = mintMissing
        ? artifactId(entry.dir)
        : readArtifactId(path.join(entry.dir, '.artifact-id'));
      return id === address;
    } catch (error) {
      if (!(error instanceof InvalidArtifactId)) throw error;
      if (entry.id === address) invalidSlug = error;
      return false;
    }
  });
  if (matches.length > 1)
    throw new Error(
      `Duplicate artifact ID: ${type}/${address} (${matches.map((entry) => entry.id).join(', ')})`,
    );
  if (matches.length === 0 && invalidSlug) throw invalidSlug;
  return (
    matches[0] ??
    (resolveArtifactDir(root, type, address)
      ? { type, id: address, dir: path.join(root, type, address) }
      : null)
  );
}
