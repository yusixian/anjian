'use strict';

const { createHash } = require('node:crypto');

const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('base64url');

function threadEvents(thread) {
  const events = [];
  thread.messages.forEach((message, index) => {
    if (message.author !== 'human') return;
    const key = `message:${message.id}`;
    events.push({
      key,
      version: digest([key, message.at, message.editedAt, message.deleted === true, message.text]),
      kind: index === 0 ? 'new-thread' : 'new-message',
      id: message.id,
      deleted: message.deleted === true,
    });
  });
  if ((thread.statusBy ?? 'human') === 'human') {
    events.push({
      key: 'status',
      version: digest([thread.status, thread.statusAt]),
      kind: thread.status === 'resolved' ? 'resolved' : 'reopened',
    });
  }
  return events;
}

function changedEvents(events, read) {
  return events.filter(({ key, version }) => !Object.hasOwn(read, key) || read[key] !== version);
}

function receiptChanges(thread, read) {
  const changes = new Set();
  const messageIds = [];
  for (const event of changedEvents(threadEvents(thread), read)) {
    if (!('id' in event)) {
      changes.add(event.kind);
      continue;
    }
    const previouslyRead = Object.hasOwn(read, event.key);
    if (event.deleted) {
      if (previouslyRead) changes.add('deleted');
      continue;
    }
    changes.add(previouslyRead ? 'edited' : event.kind);
    messageIds.push(event.id);
  }
  if (changes.has('new-thread')) changes.delete('reopened');
  return { changes: [...changes], messageIds };
}

const readerKey = (scope, session) => digest([scope, session]);

module.exports = { digest, readerKey, receiptChanges, threadEvents };
