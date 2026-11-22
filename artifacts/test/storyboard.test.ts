import { describe, expect, test } from 'vitest';

import {
  missingStoryboardAsset,
  parseStoryboard,
  storyboardDuration,
} from '../src/shared/storyboard';

const visual = (id: string, startMs: number, durationMs: number) => ({
  id,
  asset: 'assets/demo.mp4',
  startMs,
  durationMs,
  trimMs: 0,
});
const voice = {
  id: 'voice',
  asset: 'assets/voice.wav',
  startMs: 250,
  durationMs: 2000,
  trimMs: 10,
};
const plan = (clips: unknown[]) => ({
  version: 1,
  title: ' Demo reel ',
  tracks: [
    { id: 'video', name: 'Picture', kind: 'video', clips },
    { id: 'audio', name: 'Voice', kind: 'audio', clips: [voice] },
  ],
});

describe('storyboard timeline', () => {
  test('preserves track order, sorts clips chronologically and allows touching cuts', () => {
    const timeline = parseStoryboard(
      plan([visual('tail', 1000, 1000), visual('opening', 0, 1000)]),
    );
    expect(timeline?.title).toBe('Demo reel');
    expect(timeline?.tracks.map(({ id }) => id)).toEqual(['video', 'audio']);
    expect(timeline?.tracks[0]?.clips.map(({ id }) => id)).toEqual(['opening', 'tail']);
    expect(storyboardDuration(timeline!)).toBe(2250);
    expect(missingStoryboardAsset(timeline!, new Set(['assets/demo.mp4']))).toBe(
      'assets/voice.wav',
    );
  });

  test.each(
    [
      [visual('cut', 0, 500), visual('overlap', 499, 500)],
      [visual('voice', 0, 500)],
      [{ ...visual('cut', 0, 500), asset: 'https://example.test/video.mp4' }],
      [{ ...visual('cut', 0, 500), asset: 'assets/voice.wav' }],
      [{ ...visual('cut', 0, 500), asset: 'assets/../video.mp4' }],
      [visual('cut', 299_800, 500)],
      [visual('cut', 0.25, 500)],
    ].map((clips) => [clips]),
  )('rejects invalid clip timelines', (clips) => {
    expect(parseStoryboard(plan(clips))).toBeNull();
  });
});
