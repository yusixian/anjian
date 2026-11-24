import { execFile } from 'node:child_process';
import { link, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';

import { parseStoryboard, type Storyboard, storyboardDuration } from '../shared/storyboard';

export class StoryboardRenderError extends Error {}

const WIDTH = 960;
const HEIGHT = 540;
const FPS = 30;
const SAMPLE_RATE = 48_000;
const MAX_PIXELS = 16_777_216;
const MAX_ALLOCATION = String(128 * 1024 * 1024);
const RENDER_TIMEOUT_MS = 120_000;

const MEDIA_FORMATS = new Map<string, { demuxer: string; kind: 'video' | 'still' | 'audio' }>([
  ['.mp4', { demuxer: 'mov', kind: 'video' }],
  ['.webm', { demuxer: 'matroska', kind: 'video' }],
  ['.png', { demuxer: 'png_pipe', kind: 'still' }],
  ['.jpg', { demuxer: 'jpeg_pipe', kind: 'still' }],
  ['.jpeg', { demuxer: 'jpeg_pipe', kind: 'still' }],
  ['.wav', { demuxer: 'wav', kind: 'audio' }],
  ['.mp3', { demuxer: 'mp3', kind: 'audio' }],
  ['.m4a', { demuxer: 'mov', kind: 'audio' }],
]);

interface MediaStream {
  codec_type: string;
  disposition?: { attached_pic?: number };
  duration?: string;
  height?: number;
  index: number;
  start_time?: string;
  width?: number;
}

function run(command: 'ffmpeg' | 'ffprobe', args: string[], message: string, signal: AbortSignal) {
  signal.throwIfAborted();
  return new Promise<string>((resolve, reject) => {
    execFile(
      command,
      args,
      { encoding: 'utf8', killSignal: 'SIGKILL', maxBuffer: 1024 * 1024, signal },
      (error, stdout, stderr) => {
        if (signal.aborted) reject(signal.reason);
        else if (error && error.code === 'ENOENT')
          reject(
            new StoryboardRenderError(
              `${command} is unavailable. Install FFmpeg to render storyboards.`,
            ),
          );
        else if (error)
          reject(
            new StoryboardRenderError(message, {
              cause: new Error(stderr.trim() || error.message),
            }),
          );
        else resolve(stdout);
      },
    );
  });
}

async function probeMedia(asset: string, input: string | undefined, signal: AbortSignal) {
  const format = MEDIA_FORMATS.get(path.extname(asset).toLowerCase());
  if (!input || !format)
    throw new StoryboardRenderError(`Unsupported or missing storyboard asset "${asset}".`);

  // Use only local files and the expected demuxer. MOV data references can
  // otherwise point outside the staged input.
  const args = [
    '-protocol_whitelist',
    'file',
    '-f',
    format.demuxer,
    ...(format.demuxer === 'mov' ? ['-enable_drefs', '0', '-use_absolute_path', '0'] : []),
    '-i',
    path.resolve(input),
  ];
  const info: { streams: MediaStream[]; format: { duration?: string } } = JSON.parse(
    await run(
      'ffprobe',
      [
        '-v',
        'error',
        '-max_alloc',
        MAX_ALLOCATION,
        '-show_entries',
        'stream=index,codec_type,width,height,start_time,duration:stream_disposition=attached_pic:format=duration',
        '-of',
        'json',
        ...args,
      ],
      `Cannot read storyboard asset "${asset}".`,
      signal,
    ),
  );
  const streams = info.streams.filter(({ index }) => Number.isSafeInteger(index) && index >= 0);
  const video =
    format.kind === 'audio'
      ? undefined
      : streams.find(
          (stream) => stream.codec_type === 'video' && !stream.disposition?.attached_pic,
        );
  const audio =
    format.kind === 'still' ? undefined : streams.find((stream) => stream.codec_type === 'audio');
  const source = format.kind === 'audio' ? audio : video;
  if (!source) {
    throw new StoryboardRenderError(
      `Storyboard asset "${asset}" has no usable ${format.kind === 'audio' ? 'audio' : 'video'} stream.`,
    );
  }
  if (
    format.kind !== 'audio' &&
    (!source.width || !source.height || source.width * source.height > MAX_PIXELS)
  ) {
    throw new StoryboardRenderError(`Storyboard asset "${asset}" has unsupported dimensions.`);
  }
  const duration = Number(source.duration ?? info.format.duration);
  return { args, audio, duration, video, kind: format.kind };
}

const framesAt = (ms: number) => Math.ceil((ms * FPS) / 1000);
const samplesAt = (ms: number) => (ms * SAMPLE_RATE) / 1000;
const streamStart = (stream: MediaStream) => {
  const start = Number(stream.start_time);
  return Number.isFinite(start) ? start : 0;
};

// The caller supplies immutable, staged files.
// Cuts appear at the next frame on the 30 fps grid. Audio retains millisecond
// timing and mixes audio tracks with the first audio stream of each video.
export async function renderStoryboard(
  storyboard: Storyboard,
  inputs: ReadonlyMap<string, string>,
  output: string,
  signal?: AbortSignal,
): Promise<void> {
  const deadline = AbortSignal.timeout(RENDER_TIMEOUT_MS);
  const cancellation = signal ? AbortSignal.any([signal, deadline]) : deadline;
  const plan = parseStoryboard(storyboard);
  if (!plan) throw new StoryboardRenderError('The storyboard timeline is invalid.');
  const duration = storyboardDuration(plan);
  if (duration <= 0) throw new StoryboardRenderError('Add a clip before rendering the storyboard.');

  const args: string[] = [
    '-hide_banner',
    '-nostdin',
    '-loglevel',
    'error',
    '-xerror',
    '-max_alloc',
    MAX_ALLOCATION,
    '-filter_complex_threads',
    '1',
  ];
  const filters = [
    `color=c=black:s=${WIDTH}x${HEIGHT}:r=${FPS},trim=end_frame=${framesAt(duration)}[canvas]`,
    `anullsrc=r=${SAMPLE_RATE}:cl=stereo,atrim=end_sample=${samplesAt(duration)}[silence]`,
  ];
  const audioLabels = ['[silence]'];
  const mediaByAsset = new Map<string, Awaited<ReturnType<typeof probeMedia>>>();
  let videoLabel = '[canvas]';
  let inputCount = 0;

  for (const clip of plan.tracks.flatMap((track) => track.clips)) {
    let media = mediaByAsset.get(clip.asset);
    if (!media) {
      media = await probeMedia(clip.asset, inputs.get(clip.asset), cancellation);
      mediaByAsset.set(clip.asset, media);
    }
    if (media.kind !== 'still' && Number.isFinite(media.duration)) {
      const endMs = media.duration * 1000;
      if (
        clip.trimMs >= endMs ||
        (media.kind === 'audio' && clip.trimMs + clip.durationMs > endMs + 1)
      ) {
        throw new StoryboardRenderError(
          `Storyboard clip "${clip.id}" exceeds the duration of "${clip.asset}".`,
        );
      }
    }

    const startFrame = framesAt(clip.startMs);
    const endFrame = framesAt(clip.startMs + clip.durationMs);
    const video = endFrame > startFrame ? media.video : undefined;
    const audioOffset =
      media.video && media.audio ? streamStart(media.audio) - streamStart(media.video) : 0;
    const audio = audioOffset * 1000 < clip.trimMs + clip.durationMs ? media.audio : undefined;
    if (!video && !audio) continue;
    const index = inputCount++;
    args.push('-threads', '1', '-max_pixels', String(MAX_PIXELS), ...media.args);

    if (video) {
      // Sample each source at the displayed frame's position in the clip.
      const sourceOffset = (clip.trimMs - clip.startMs) / 1000 + startFrame / FPS;
      const layer = `[clip${index}]`;
      const next = `[video${index}]`;
      // Pad before sampling so a cut near EOF can still select the last frame.
      const timing =
        media.kind === 'still'
          ? `trim=end_frame=1,fps=${FPS},tpad=stop_mode=clone:stop=-1`
          : `settb=AVTB,setpts=PTS-STARTPTS-${sourceOffset.toFixed(9)}/TB,tpad=stop_mode=clone:stop=-1,fps=${FPS}:start_time=0:round=up`;
      filters.push(
        `[${index}:${video.index}]${timing},trim=end_frame=${endFrame - startFrame},setpts=PTS-STARTPTS+${startFrame},` +
          `format=yuva420p,scale=w='max(2,trunc(min(${WIDTH},${HEIGHT}*dar)/2)*2)':h='max(2,trunc(min(${HEIGHT},${WIDTH}/dar)/2)*2)',setsar=1${layer}`,
        `${videoLabel}${layer}overlay=x=(W-w)/2:y=(H-h)/2:enable='gte(n,${startFrame})*lt(n,${endFrame})'${next}`,
      );
      videoLabel = next;
    }

    if (audio) {
      const label = `[audio${index}]`;
      filters.push(
        `[${index}:${audio.index}]asetpts=PTS-STARTPTS+(${audioOffset.toFixed(9)})/TB,` +
          `aresample=${SAMPLE_RATE}:async=1:first_pts=0,aformat=sample_fmts=fltp:channel_layouts=stereo,` +
          `atrim=start_sample=${samplesAt(clip.trimMs)}:end_sample=${samplesAt(clip.trimMs + clip.durationMs)},` +
          `asetpts=PTS-STARTPTS,adelay=${samplesAt(clip.startMs)}S:all=1${label}`,
      );
      audioLabels.push(label);
    }
  }
  const audioLabel = audioLabels.length === 1 ? '[silence]' : '[audio]';
  if (audioLabels.length > 1)
    filters.push(
      `${audioLabels.join('')}amix=inputs=${audioLabels.length}:duration=first:normalize=0,` +
        `alimiter=limit=0.95:level=0:latency=1${audioLabel}`,
    );

  const temporary = await mkdtemp(path.join(path.dirname(path.resolve(output)), '.storyboard-'));
  const encoded = path.join(temporary, 'storyboard.mp4');
  try {
    await run(
      'ffmpeg',
      [
        ...args,
        '-filter_complex',
        filters.join(';'),
        '-map',
        videoLabel,
        '-map',
        audioLabel,
        '-map_metadata',
        '-1',
        '-map_chapters',
        '-1',
        '-c:v',
        'libx264',
        '-threads:v',
        '2',
        '-preset',
        'veryfast',
        '-crf',
        '20',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-movflags',
        '+faststart',
        '-f',
        'mp4',
        encoded,
      ],
      'FFmpeg could not render the storyboard. Check that its media files can be decoded.',
      cancellation,
    );
    cancellation.throwIfAborted();
    // Publish only the completed file and never replace an existing path.
    await link(encoded, output);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
