import type { ReactElement } from 'react';

import { BaseQuestionNode, type SerializedQuestionNode } from '../../shared/document-question-node';
import { DocumentQuestionCard } from './DocumentQuestionCard';

export class QuestionNode extends BaseQuestionNode<ReactElement> {
  static getType() {
    return 'question';
  }

  static clone(node: QuestionNode) {
    return new QuestionNode(node.__definition, node.__key);
  }

  static importJSON(json: SerializedQuestionNode) {
    return new QuestionNode(json.definition).updateFromJSON(json);
  }

  createDOM() {
    return document.createElement('div');
  }

  decorate() {
    return <DocumentQuestionCard definition={this.getLatest().__definition} />;
  }
}
