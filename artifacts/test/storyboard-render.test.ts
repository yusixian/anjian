import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, test } from 'vitest';

import { renderStoryboard } from '../src/server/storyboard-render';
import type { Storyboard } from '../src/shared/storyboard';

const root = mkdtempSync(path.join(tmpdir(), 'anjian-storyboard-render-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

function run(command: string, args: string[]) {
  const result = spawnSync(command, ['-v', 'error', ...args]);
  assert.equal(result.status, 0, result.stderr?.toString() || result.error?.message);
  return result.stdout;
}

function pixel(file: string, frame: number, x = 480) {
  return Array.from(
    run('ffmpeg', [
      '-i',
      file,
      '-vf',
      `select=eq(n\\,${frame}),format=rgb24,crop=1:1:${x}:270`,
      '-frames:v',
      '1',
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgb24',
      'pipe:1',
    ]),
  );
}

function audioAt(file: string, time: number) {
  return run('ffmpeg', [
    '-ss',
    String(time),
    '-i',
    file,
    '-t',
    '0.07',
    '-vn',
    '-ac',
    '1',
    '-f',
    'f32le',
    'pipe:1',
  ]);
}

function amplitude(audio: Buffer, hz: number) {
  assert.ok(audio.length > 0);
  let real = 0;
  let imaginary = 0;
  for (let frame = 0; frame < audio.length / 4; frame++) {
    const value = audio.readFloatLE(frame * 4);
    const phase = (2 * Math.PI * hz * frame) / 48_000;
    real += value * Math.cos(phase);
    imaginary += value * Math.sin(phase);
  }
  return (8 * Math.hypot(real, imaginary)) / audio.length;
}

test('renders trimmed clips, layered stills, timeline gaps and mixed audio as a faststart MP4', async () => {
  const video = path.join(root, 'video with spaces; $literal.mp4');
  const still = path.join(root, 'overlay.png');
  const wav = path.join(root, 'tone.wav');
  const output = path.join(root, 'storyboard.mp4');
  run('ffmpeg', [
    '-f',
    'lavfi',
    '-i',
    'color=red:s=160x90:r=30:d=0.5',
    '-f',
    'lavfi',
    '-i',
    'color=lime:s=160x90:r=30:d=0.8',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=400:sample_rate=48000:duration=1.3',
    '-filter_complex',
    '[0:v][1:v]concat=n=2:v=1:a=0[v]',
    '-map',
    '[v]',
    '-map',
    '2:a',
    '-c:v',
    'libx264',
    '-c:a',
    'aac',
    video,
  ]);
  run('ffmpeg', ['-f', 'lavfi', '-i', 'color=blue:s=90x90', '-frames:v', '1', still]);
  run('ffmpeg', ['-f', 'lavfi', '-i', 'sine=frequency=600:sample_rate=48000:duration=0.5', wav]);

  const storyboard: Storyboard = {
    version: 1,
    title: 'Layered demo',
    tracks: [
      {
        id: 'base',
        name: 'Base',
        kind: 'video',
        clips: [
          { id: 'demo', asset: 'assets/demo.mp4', startMs: 155, trimMs: 500, durationMs: 798 },
        ],
      },
      {
        id: 'front',
        name: 'Front',
        kind: 'video',
        clips: [
          { id: 'image', asset: 'assets/panel.png', startMs: 500, trimMs: 0, durationMs: 200 },
        ],
      },
      {
        id: 'sound',
        name: 'Sound',
        kind: 'audio',
        clips: [
          { id: 'tone', asset: 'assets/tone.wav', startMs: 400, trimMs: 50, durationMs: 400 },
          { id: 'outro', asset: 'assets/tone.wav', startMs: 1100, trimMs: 0, durationMs: 300 },
        ],
      },
    ],
  };
  await renderStoryboard(
    storyboard,
    new Map([
      ['assets/demo.mp4', video],
      ['assets/panel.png', still],
      ['assets/tone.wav', wav],
    ]),
    output,
  );

  const media = JSON.parse(
    run('ffprobe', ['-show_format', '-show_streams', '-of', 'json', output]).toString(),
  );
  assert.ok(Math.abs(Number(media.format.duration) - 1.4) < 0.04);
  const visual = media.streams.find(
    (stream: { codec_type: string }) => stream.codec_type === 'video',
  );
  assert.equal(visual.codec_name, 'h264');
  assert.equal(visual.r_frame_rate, '30/1');
  assert.equal(
    media.streams.find((stream: { codec_type: string }) => stream.codec_type === 'audio')
      .codec_name,
    'aac',
  );
  const mp4 = readFileSync(output);
  assert.ok(mp4.indexOf('moov') > 0 && mp4.indexOf('moov') < mp4.indexOf('mdat'));

  assert.deepEqual(pixel(output, 4), [0, 0, 0], 'frame before the rounded start is black');
  assert.ok(pixel(output, 5)[1]! > 200, 'the first clip frame is taken after the red lead-in');
  assert.ok(pixel(output, 18)[2]! > 200, 'the upper still occludes the base at the center');
  assert.ok(pixel(output, 18, 48)[1]! > 200, 'the base remains visible beside the square still');
  assert.ok(pixel(output, 21)[1]! > 200, 'the still ends on its exact time boundary');
  assert.ok(
    pixel(output, 28)[1]! > 200,
    'the last displayed frame within the base clip remains visible',
  );
  assert.deepEqual(pixel(output, 29), [0, 0, 0], 'frame after the rounded end is black');

  assert.ok(amplitude(audioAt(output, 0.04), 400) < 0.005, 'the opening gap is silent');
  assert.ok(amplitude(audioAt(output, 0.24), 400) > 0.04, 'the video audio is audible');
  const mixed = audioAt(output, 0.5);
  assert.ok(
    amplitude(mixed, 400) > 0.04 && amplitude(mixed, 600) > 0.04,
    'both clips are audible while overlapping',
  );
  const gap = audioAt(output, 1);
  assert.ok(
    amplitude(gap, 400) < 0.005 && amplitude(gap, 600) < 0.005,
    'the gap between clips is silent',
  );
  assert.ok(
    amplitude(audioAt(output, 1.18), 600) > 0.04,
    'audio continues over black after the visual clips',
  );
}, 15_000);

test('preserves the offset between a trimmed WebM and its embedded audio', async () => {
  const video = path.join(root, 'delayed-audio.webm');
  const output = path.join(root, 'delayed-audio.mp4');
  run('ffmpeg', [
    '-f',
    'lavfi',
    '-i',
    'color=yellow:s=160x90:r=30:d=0.8',
    '-itsoffset',
    '0.3',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=500:sample_rate=48000:duration=0.4',
    '-map',
    '0:v',
    '-map',
    '1:a',
    '-c:v',
    'libvpx-vp9',
    '-c:a',
    'libopus',
    video,
  ]);
  const storyboard: Storyboard = {
    version: 1,
    title: 'Delayed audio',
    tracks: [
      {
        id: 'base',
        name: 'Base',
        kind: 'video',
        clips: [
          { id: 'demo', asset: 'assets/demo.webm', startMs: 0, trimMs: 100, durationMs: 500 },
        ],
      },
    ],
  };
  await renderStoryboard(storyboard, new Map([['assets/demo.webm', video]]), output);
  const [red, green, blue] = pixel(output, 0);
  assert.ok(red! > 200 && green! > 200 && blue! < 20);
  assert.ok(amplitude(audioAt(output, 0.04), 500) < 0.005);
  assert.ok(amplitude(audioAt(output, 0.25), 500) > 0.04);
});

test('holds the final video frame through a longer clip while audio ends naturally', async () => {
  const video = path.join(root, 'short-picture.mp4');
  const output = path.join(root, 'held-picture.mp4');
  run('ffmpeg', [
    '-f',
    'lavfi',
    '-i',
    'color=c=red:s=160x90:r=30:d=0.4',
    '-f',
    'lavfi',
    '-i',
    'color=c=blue:s=160x90:r=30:d=0.3',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=500:sample_rate=48000:duration=0.7',
    '-filter_complex',
    '[0:v][1:v]concat=n=2:v=1:a=0[video]',
    '-map',
    '[video]',
    '-map',
    '2:a',
    '-c:v',
    'libx264',
    '-c:a',
    'aac',
    video,
  ]);
  const storyboard: Storyboard = {
    version: 1,
    title: 'Hold the final frame',
    tracks: [
      {
        id: 'video',
        name: 'Video',
        kind: 'video',
        clips: [
          { id: 'clip', asset: 'assets/short.mp4', startMs: 155, trimMs: 200, durationMs: 1500 },
        ],
      },
    ],
  };
  const inputs = new Map([['assets/short.mp4', video]]);
  await renderStoryboard(storyboard, inputs, output);
  assert.deepEqual(pixel(output, 4), [0, 0, 0]);
  assert.ok(pixel(output, 5)[0]! > 200, 'trimmed clip starts in the first color');
  assert.ok(pixel(output, 20)[2]! > 200, 'the second color is shown before the source ends');
  assert.deepEqual(
    pixel(output, 49),
    pixel(output, 20),
    'the final color persists through the last timeline frame',
  );
  assert.ok(amplitude(audioAt(output, 0.3), 500) > 0.04, 'embedded audio plays during the source');
  assert.ok(amplitude(audioAt(output, 1.1), 500) < 0.005, 'the held picture adds no audio');

  const clip = storyboard.tracks[0]!.clips[0]!;
  const nearEnd = path.join(root, 'held-from-tail.mp4');
  await renderStoryboard(
    {
      ...storyboard,
      tracks: [{ ...storyboard.tracks[0]!, clips: [{ ...clip, trimMs: 699 }] }],
    },
    inputs,
    nearEnd,
  );
  assert.ok(
    pixel(nearEnd, 5)[2]! > 200,
    'a fractional cut near EOF can still sample the final frame',
  );
  await assert.rejects(
    renderStoryboard(
      {
        ...storyboard,
        tracks: [{ ...storyboard.tracks[0]!, clips: [{ ...clip, trimMs: 701 }] }],
      },
      inputs,
      path.join(root, 'past-eof.mp4'),
    ),
    /exceeds the duration/,
  );
}, 15_000);

test('rejects missing media, malformed media and source ranges that cannot play', async () => {
  const audio = path.join(root, 'short.wav');
  const broken = path.join(root, 'broken.wav');
  const output = path.join(root, 'failed.mp4');
  run('ffmpeg', ['-f', 'lavfi', '-i', 'sine=duration=0.3', audio]);
  writeFileSync(broken, 'unreadable file');
  const storyboard: Storyboard = {
    version: 1,
    title: 'Invalid clips',
    tracks: [
      {
        id: 'audio',
        name: 'Audio',
        kind: 'audio',
        clips: [
          { id: 'clip', asset: 'assets/audio.wav', startMs: 0, trimMs: 200, durationMs: 200 },
        ],
      },
    ],
  };
  await assert.rejects(renderStoryboard(storyboard, new Map(), output), /missing storyboard asset/);
  await assert.rejects(
    renderStoryboard(storyboard, new Map([['assets/audio.wav', broken]]), output),
    /cannot read storyboard asset/i,
  );
  await assert.rejects(
    renderStoryboard(storyboard, new Map([['assets/audio.wav', audio]]), output),
    /exceeds the duration/,
  );
  await assert.rejects(
    renderStoryboard(
      storyboard,
      new Map([['assets/audio.wav', audio]]),
      output,
      AbortSignal.abort(),
    ),
    { name: 'AbortError' },
  );
  assert.equal(existsSync(output), false);
  assert.ok(readdirSync(root).every((name) => !name.startsWith('.storyboard-')));
});
