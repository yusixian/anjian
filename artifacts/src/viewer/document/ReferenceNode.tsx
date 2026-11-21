import type { ReactElement } from 'react';

import {
  BaseReferenceNode,
  type SerializedReferenceNode,
} from '../../shared/artifact-reference-node';
import { ArtifactReferenceCard } from './ArtifactReferenceCard';

export class ReferenceNode extends BaseReferenceNode<ReactElement> {
  static getType() {
    return 'artifact-reference';
  }

  static clone(node: ReferenceNode) {
    return new ReferenceNode(node.__reference, node.__key);
  }

  static importJSON(json: SerializedReferenceNode) {
    return new ReferenceNode(json.reference).updateFromJSON(json);
  }

  createDOM() {
    return document.createElement('div');
  }

  decorate() {
    return <ArtifactReferenceCard reference={this.getLatest().__reference} />;
  }
}
