'use strict';

const { createHash, randomBytes, randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const SESSION = /^[a-z0-9][\w.-]{0,124}$/i;
const DOCUMENT = /^document\/[a-z0-9][a-z0-9-]*$/;
const hash = (value, encoding = 'hex') => createHash('sha256').update(value).digest(encoding);

function eachDocument(sources, visit) {
  for (const [project, artifacts] of sources) {
    for (const artifact of artifacts) {
      if (DOCUMENT.test(artifact)) visit(project, artifact);
    }
  }
}

function formatMessage({ artifact, revision, definition, answer }) {
  const option = definition.options?.find(({ id }) => id === answer);
  return (
    `The human submitted an answer to Anjian question ${JSON.stringify(definition.id)} in ${artifact}.\n` +
    `Document revision: ${revision}\nQuestion: ${JSON.stringify(definition.prompt)}\n` +
    (option
      ? `Selected option: ${JSON.stringify(option.label)} (ID ${JSON.stringify(answer)})`
      : `Answer: ${JSON.stringify(answer)}`)
  );
}

function createLocalQuestionDispatch(host, session) {
  if (!SESSION.test(session)) throw new Error('Anjian feedback needs a valid session ID');
  const token = randomBytes(32).toString('hex');
  const recipient = hash(JSON.stringify([host, session]), 'base64url');
  const proof = hash(token);
  const receipts = new Map();
  const stateDir = (project) => path.join(project, '.anjian', 'artifacts', '.state');
  const heartbeat = (project, artifact) =>
    path.join(
      stateDir(project),
      host + '-comment-watch',
      'questions',
      artifact,
      session + '.alive',
    );

  function update(sources) {
    eachDocument(sources, (project, artifact) => {
      const file = heartbeat(project, artifact);
      const temporary = file + '.' + randomUUID() + '.tmp';
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
        fs.writeFileSync(temporary, Date.now() + ' ' + proof, { mode: 0o600, flag: 'wx' });
        fs.renameSync(temporary, file);
      } catch {
        try {
          fs.rmSync(temporary, { force: true });
        } catch {
          // The temporary heartbeat is ignored by the Hub.
        }
      }
    });
  }

  function close(sources) {
    eachDocument(sources, (project, artifact) => {
      const file = heartbeat(project, artifact);
      try {
        if (fs.readFileSync(file, 'utf8').endsWith(' ' + proof)) fs.rmSync(file, { force: true });
      } catch {
        // A remaining heartbeat expires without another write.
      }
    });
  }

  function endpoint(project, artifact) {
    try {
      const info = JSON.parse(fs.readFileSync(path.join(stateDir(project), 'server-info'), 'utf8'));
      const local = new URL(info.localUrl);
      if (
        !/^[a-f0-9]{32}$/.test(info.localQuestionProject) ||
        info.root !== path.dirname(stateDir(project)) ||
        local.protocol !== 'http:' ||
        !['127.0.0.1', '[::1]', 'localhost'].includes(local.hostname) ||
        local.username ||
        local.password ||
        local.search ||
        local.hash
      )
        return null;
      return new URL(
        `/api/local/projects/${info.localQuestionProject}/${artifact}/questions/${recipient}`,
        local,
      ).href;
    } catch {
      return null;
    }
  }

  const post = (url) =>
    fetch(url, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token },
      redirect: 'error',
      signal: AbortSignal.timeout(1500),
    });

  async function acknowledge(url, id) {
    receipts.set(url, id);
    try {
      const response = await post(url + '/' + id);
      if (response.ok || response.status === 409) receipts.delete(url);
    } catch {
      // Retry the receipt before polling this document again.
    }
  }

  async function next(sources) {
    const targets = [];
    eachDocument(sources, (project, artifact) => {
      const url = endpoint(project, artifact);
      if (url) targets.push({ url, artifact });
    });
    for (const { url, artifact } of targets) {
      try {
        const previous = receipts.get(url);
        if (previous) {
          await acknowledge(url, previous);
          continue;
        }
        const response = await post(url);
        if (!response.ok) continue;
        const { delivery } = await response.json();
        if (
          !delivery ||
          delivery.artifact !== artifact ||
          !/^[a-f0-9-]{36}$/.test(delivery.id) ||
          !/^sha256:[a-f0-9]{64}$/.test(delivery.revision) ||
          typeof delivery.definition?.id !== 'string' ||
          typeof delivery.definition.prompt !== 'string' ||
          typeof delivery.answer !== 'string'
        )
          continue;
        return {
          artifact,
          message: formatMessage(delivery),
          acknowledge: () => acknowledge(url, delivery.id),
        };
      } catch {
        // A local Hub may be restarting. Keep polling while the session is subscribed.
      }
    }
  }

  return { close, next, update };
}

module.exports = { createLocalQuestionDispatch };
