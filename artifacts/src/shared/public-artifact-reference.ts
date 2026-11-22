import type { SerializedLexicalNode, Spread } from 'lexical';

import type { ArtifactType } from './types';

export const PUBLIC_ARTIFACT_REFERENCE = 'public-artifact-reference';
export const PUBLIC_SHARE_TOKEN = String.raw`[\w-]{43}`;
const tokenPattern = new RegExp(`^${PUBLIC_SHARE_TOKEN}$`);
export const isPublicShareToken = (value: string) => tokenPattern.test(value);

export type SerializedPublicArtifactReference = Spread<
  {
    type: typeof PUBLIC_ARTIFACT_REFERENCE;
    artifactType: ArtifactType;
    label?: string;
    token?: string;
  },
  SerializedLexicalNode
>;
