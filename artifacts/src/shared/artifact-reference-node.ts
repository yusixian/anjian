import { DecoratorNode, type NodeKey, type SerializedLexicalNode, type Spread } from 'lexical';

import { type ArtifactReference, validateArtifactReference } from './artifact-reference';

export type SerializedReferenceNode = Spread<
  { reference: ArtifactReference },
  SerializedLexicalNode
>;

export abstract class BaseReferenceNode<T> extends DecoratorNode<T> {
  __reference: ArtifactReference;

  constructor(reference: ArtifactReference, key?: NodeKey) {
    super(key);
    this.__reference = reference;
  }

  updateFromJSON(json: SerializedReferenceNode): this {
    validateArtifactReference(json.reference);
    const node = super.updateFromJSON(json).getWritable();
    node.__reference = json.reference;
    return node;
  }

  exportJSON(): SerializedReferenceNode {
    return {
      ...super.exportJSON(),
      type: 'artifact-reference',
      version: 1,
      reference: this.getLatest().__reference,
    };
  }

  updateDOM() {
    return false;
  }

  isInline() {
    return false;
  }

  getTextContent() {
    const { label, target } = this.getLatest().__reference;
    return label ?? target;
  }
}
