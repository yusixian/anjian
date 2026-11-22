import { DecoratorNode, type NodeKey } from 'lexical';
import { ArrowUpRight } from 'lucide-react';
import type { ReactElement } from 'react';

import {
  isPublicShareToken,
  PUBLIC_ARTIFACT_REFERENCE,
  type SerializedPublicArtifactReference,
} from '../../shared/public-artifact-reference';
import { TypeIcon } from '../components/TypeIcon';
import { i18n } from '../i18n';

const language = () => (/^en(?:-|$)/i.test(navigator.language) ? 'en' : 'zh');

export class PublicReferenceNode extends DecoratorNode<ReactElement> {
  constructor(
    readonly data: SerializedPublicArtifactReference,
    key?: NodeKey,
  ) {
    super(key);
  }

  static getType() {
    return PUBLIC_ARTIFACT_REFERENCE;
  }

  static clone(node: PublicReferenceNode) {
    return new PublicReferenceNode(node.data, node.__key);
  }

  static importJSON(data: SerializedPublicArtifactReference) {
    return new PublicReferenceNode(data).updateFromJSON(data);
  }

  exportJSON() {
    return this.getLatest().data;
  }

  createDOM() {
    return document.createElement('div');
  }

  updateDOM() {
    return false;
  }

  isInline() {
    return false;
  }

  getTextContent() {
    const { artifactType, label } = this.getLatest().data;
    return label ?? i18n.t(`type.${artifactType}`, { lng: language() });
  }

  decorate() {
    const { artifactType, label, token } = this.getLatest().data;
    const lng = language();
    const type = i18n.t(`type.${artifactType}`, { lng });
    const body = (
      <>
        <TypeIcon type={artifactType} size={20} />
        <span className="share-reference-body">
          <strong>{label ?? i18n.t('reference.static', { lng })}</strong>
          <span>{type}</span>
        </span>
      </>
    );
    if (!token || !isPublicShareToken(token)) return <div className="share-reference">{body}</div>;
    // Asset URLs use a preview-origin <base>, while public navigation stays on this origin.
    return (
      <a
        className="share-reference"
        href={new URL(`/s/${token}`, location.origin).href}
        referrerPolicy="no-referrer"
      >
        {body}
        <ArrowUpRight aria-hidden="true" size={16} />
      </a>
    );
  }
}
