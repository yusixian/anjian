import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import type { NarrationLine } from '../shared/storyboard-narration';
import { StoryboardError } from './storyboard-source';

const SAY = '/usr/bin/say';
const exec = promisify(execFile);
const MAX_SECONDS = 90;

const voiceList = {
  'en-US': 'en_US',
  'zh-CN': 'zh_CN',
} as const;

export const narrationAvailable = (loopback: boolean) => loopback && process.platform === 'darwin';

let active = false;

export async function synthesizeNarration(text: string, locale: NarrationLine['locale']) {
  if (active) throw new StoryboardError(429, 'A narration line is already generating.');
  active = true;
  let directory: string | undefined;
  const signal = AbortSignal.timeout(30_000);
  try {
    const { stdout } = await exec(SAY, ['-v', '?'], { signal });
    const suffix = new RegExp(`\\s+${voiceList[locale]}\\s+#.*$`);
    const voices = stdout
      .split('\n')
      .filter((row) => suffix.test(row))
      .map((row) => row.replace(suffix, '').trim());
    const voice = voices.find((name) => name.startsWith('Eddy')) ?? voices[0];
    if (!voice) throw new StoryboardError(422, 'Install a system voice for the selected language.');

    directory = await mkdtemp(path.join(os.tmpdir(), 'anjian-narration-'));
    const input = path.join(directory, 'line.txt');
    const aiff = path.join(directory, 'line.aiff');
    const wav = path.join(directory, 'line.wav');
    // NSSpeechSynthesizer interprets bracket commands even from an input file.
    await writeFile(
      input,
      text.replaceAll(/\[{2,}/g, (brackets) => [...brackets].join(' ')),
      { mode: 0o600 },
    );
    await exec(SAY, ['-v', voice, '-f', input, '-o', aiff], { signal });
    await exec(
      'ffmpeg',
      [
        '-nostdin',
        '-v',
        'error',
        '-f',
        'aiff',
        '-i',
        aiff,
        '-t',
        String(MAX_SECONDS + 1),
        '-ac',
        '1',
        '-ar',
        '48000',
        '-c:a',
        'pcm_s16le',
        wav,
      ],
      { signal },
    );
    const audio = await readFile(wav);
    if (audio.length >= MAX_SECONDS * 96_000)
      throw new StoryboardError(422, 'Shorten this narration line and try again.');
    return audio;
  } catch (error) {
    if (error instanceof StoryboardError) throw error;
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      throw new StoryboardError(503, 'Install FFmpeg and make sure system speech is available.');
    throw new StoryboardError(422, 'Unable to generate narration with the selected system voice.');
  } finally {
    try {
      if (directory) await rm(directory, { recursive: true, force: true });
    } finally {
      active = false;
    }
  }
}
