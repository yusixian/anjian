'use strict';

const { readerKey, receiptChanges } = require('./comment-receipt-events.cjs');

const stampOf = (m) => m.editedAt || m.at;
const humanStatus = (thread) => (thread.statusBy || 'human') === 'human';

const isChoiceRecord = (thread) =>
  thread.anchor?.choice !== undefined || thread.anchor?.submit !== undefined;

function waitingOnAgent(thread) {
  if (thread.status === 'resolved') return false;
  const live = (thread.messages || []).filter((m) => !m.deleted);
  return live.length > 0 && live.at(-1).author === 'human';
}

function changedSince(thread, cursor) {
  const messages = thread.messages || [];
  let changed = false;
  let newThread = false;
  messages.forEach((m, index) => {
    if (m.author !== 'human') return;
    const created = m.at > cursor;
    if (m.deleted) {
      if (!created && stampOf(m) > cursor) changed = true;
      return;
    }
    if (created || stampOf(m) > cursor) changed = true;
    if (created && index === 0) newThread = true;
  });
  if (
    !newThread &&
    humanStatus(thread) &&
    thread.statusAt > cursor &&
    messages.some((m) => m.at <= cursor)
  )
    changed = true;
  return changed;
}

// Mirrors unreadThreads in artifacts/src/shared/comments.ts; artifacts/test/hook-parity.test.ts keeps them in step.
function unreadThreadCount(file, cursor) {
  const threads = file && Array.isArray(file.threads) ? file.threads : [];
  return threads.filter(
    (thread) =>
      !isChoiceRecord(thread) &&
      (cursor === null ? waitingOnAgent(thread) : changedSince(thread, cursor)),
  ).length;
}

function unreadReceiptCount(file, book, session) {
  const reader = book?.[readerKey('local', session)];
  const threads = file && Array.isArray(file.threads) ? file.threads : [];
  return threads.filter((thread) => {
    if (!thread || !Array.isArray(thread.messages)) return false;
    if (isChoiceRecord(thread)) return false;
    if (!reader) return waitingOnAgent(thread);
    const versionsOf = (entries) =>
      entries && Object.hasOwn(entries, thread.id) ? entries[thread.id] : {};
    const snapshot = { ...versionsOf(reader.baseline), ...versionsOf(reader.read) };
    return receiptChanges(thread, snapshot).changes.length > 0;
  }).length;
}

module.exports = { unreadReceiptCount, unreadThreadCount };
