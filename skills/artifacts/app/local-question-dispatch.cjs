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
  const delivered = new Set();
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

  async function post(url) {
    const response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token },
      redirect: 'error',
      signal: AbortSignal.timeout(1500),
    });
    if (!response.ok) return null;
    return response.json();
  }

  async function next(sources) {
    const targets = [];
    eachDocument(sources, (project, artifact) => {
      const url = endpoint(project, artifact);
      if (url) targets.push({ url, artifact });
    });
    for (const { url, artifact } of targets) {
      try {
        const { delivery } = (await post(url)) ?? {};
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
        async function acknowledge() {
          delivered.add(delivery.id);
          try {
            if (await post(url + '/' + delivery.id)) delivered.delete(delivery.id);
          } catch {
            // A later offer retries the acknowledgment without sending the message again.
          }
        }
        if (delivered.has(delivery.id)) {
          await acknowledge();
          continue;
        }
        return { artifact, message: formatMessage(delivery), acknowledge };
      } catch {
        // A local Hub may be restarting. Keep polling while the session is subscribed.
      }
    }
    // If an acknowledgment succeeded but its response was lost, retain only the recent IDs.
    if (delivered.size > 200) delivered.delete(delivered.values().next().value);
  }

  return { close, next, update };
}

module.exports = { createLocalQuestionDispatch };
