/**
 * The project's central claim, as tests.
 *
 * The golden hashes below pin the output of specific seeds. They are not
 * arbitrary: if a change to the noise, the integrator or a renderer alters
 * what a seed produces, every previously shared link and every gallery piece
 * silently becomes a different image. These tests make that break loudly.
 *
 * Deliberately changing an algorithm means updating these hashes in the same
 * commit — which is exactly the moment to think about whether to do it.
 */

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { generate } from '../src/core/generate';
import { renderSvg } from '../src/core/render/svg';
import { rasterize } from '../src/core/render/raster';
import { encodePng } from '../src/core/render/png';

const sha = (data: string | Uint8Array): string =>
  createHash('sha256').update(data).digest('hex').slice(0, 16);

const FLOW = {
  algo: 'flow',
  seed: 'harbour-drift',
  palette: 'kelp',
  width: 400,
  height: 500,
  params: { particles: 200, steps: 120 },
} as const;

const REACTION = {
  algo: 'reaction',
  seed: 'coral-7',
  palette: 'riso',
  width: 300,
  height: 300,
  params: { gridSize: 56, iterations: 400, feed: 0.0545, kill: 0.062, contours: 3 },
} as const;

describe('a seed is a pure function', () => {
  it('flow: two generations are deep-equal', () => {
    expect(generate({ ...FLOW })).toEqual(generate({ ...FLOW }));
  });

  it('reaction: two generations are deep-equal', () => {
    expect(generate({ ...REACTION })).toEqual(generate({ ...REACTION }));
  });

  it('flow: SVG bytes are identical across renders', () => {
    expect(renderSvg(generate({ ...FLOW }))).toBe(renderSvg(generate({ ...FLOW })));
  });

  it('reaction: PNG bytes are identical across renders', () => {
    const png = (): Uint8Array => encodePng(rasterize(generate({ ...REACTION })));
    expect(sha(png())).toBe(sha(png()));
  });
});

describe('golden hashes', () => {
  it('flow SVG matches its recorded hash', () => {
    expect(sha(renderSvg(generate({ ...FLOW })))).toBe('f2a9782211e46b32');
  });

  it('flow PNG matches its recorded hash', () => {
    expect(sha(encodePng(rasterize(generate({ ...FLOW }))))).toBe('4f7ecbc8eb0141f9');
  });

  it('reaction SVG matches its recorded hash', () => {
    expect(sha(renderSvg(generate({ ...REACTION })))).toBe('6b45275bb64a8767');
  });

  it('reaction PNG matches its recorded hash', () => {
    expect(sha(encodePng(rasterize(generate({ ...REACTION }))))).toBe('c1a89ad8ad3df288');
  });
});

describe('neighbouring inputs diverge', () => {
  it('a one-character seed change gives a different piece', () => {
    const a = sha(renderSvg(generate({ ...FLOW })));
    const b = sha(renderSvg(generate({ ...FLOW, seed: 'harbour-drif' })));
    expect(a).not.toBe(b);
  });

  it('a palette change gives a different piece', () => {
    const a = sha(renderSvg(generate({ ...FLOW })));
    const b = sha(renderSvg(generate({ ...FLOW, palette: 'oxide' })));
    expect(a).not.toBe(b);
  });

  it('a single extra particle gives a different piece', () => {
    const a = sha(renderSvg(generate({ ...FLOW })));
    const b = sha(
      renderSvg(generate({ ...FLOW, params: { ...FLOW.params, particles: 201 } })),
    );
    expect(a).not.toBe(b);
  });
});
