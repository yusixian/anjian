import {
  $getRoot,
  COMMAND_PRIORITY_EDITOR,
  DecoratorNode,
  type LexicalEditor,
  type NodeKey,
  SELECTION_INSERT_CLIPBOARD_NODES_COMMAND,
  type SerializedLexicalNode,
  type Spread,
} from 'lexical';
import { nanoid } from 'nanoid';

import type { DocumentQuestion } from './document-questions';

export type SerializedQuestionNode = Spread<
  { definition: DocumentQuestion },
  SerializedLexicalNode
>;

export abstract class BaseQuestionNode<T> extends DecoratorNode<T> {
  __definition: DocumentQuestion;

  constructor(definition: DocumentQuestion, key?: NodeKey) {
    super(key);
    this.__definition = definition;
  }

  updateFromJSON(json: SerializedQuestionNode): this {
    const node = super.updateFromJSON(json).getWritable();
    node.__definition = json.definition;
    return node;
  }

  exportJSON(): SerializedQuestionNode {
    return {
      ...super.exportJSON(),
      type: 'question',
      version: 1,
      definition: this.getLatest().__definition,
    };
  }

  updateDOM() {
    return false;
  }

  isInline() {
    return false;
  }

  getTextContent() {
    return this.getLatest().__definition.prompt;
  }
}

export function registerQuestionClipboard(editor: LexicalEditor) {
  return editor.registerCommand(
    SELECTION_INSERT_CLIPBOARD_NODES_COMMAND,
    ({ nodes }) => {
      const questions = nodes.filter((node) => node instanceof BaseQuestionNode);
      if (!questions.length) return false;

      const ids = new Set(
        $getRoot()
          .getChildren()
          .filter((node) => node instanceof BaseQuestionNode)
          .map((node) => node.__definition.id),
      );
      for (const question of questions) {
        const definition = question.__definition;
        let id = definition.id;
        while (ids.has(id)) id = `q-${nanoid()}`;
        if (id !== definition.id) question.getWritable().__definition = { ...definition, id };
        ids.add(id);
      }
      return false;
    },
    COMMAND_PRIORITY_EDITOR,
  );
}
