import { describe, it, expect } from 'vitest';
import { inflateSync } from 'node:zlib';
import { renderSvg } from '../src/core/render/svg';
import { rasterize, downsample, hexToRgb, type Raster } from '../src/core/render/raster';
import { encodePng } from '../src/core/render/png';
import { deflateRaw, zlibCompress, adler32 } from '../src/core/render/deflate';
import { simplifyPath } from '../src/core/simplify';
import type { Scene } from '../src/core/types';

const scene: Scene = {
  width: 100,
  height: 60,
  background: '#102030',
  layers: [
    {
      color: '#ff4d8d',
      width: 2,
      opacity: 0.8,
      paths: [
        [
          { x: 10, y: 10 },
          { x: 50, y: 30 },
          { x: 90, y: 10 },
        ],
      ],
    },
    {
      color: '#2b4bd8',
      width: 1,
      opacity: 1,
      paths: [
        [
          { x: 5, y: 50 },
          { x: 95, y: 50 },
        ],
      ],
    },
  ],
  meta: { algo: 'flow', seed: 'test', palette: 'riso', params: { particles: 1 } },
};

describe('hexToRgb', () => {
  it('handles long and short form', () => {
    expect(hexToRgb('#ff4d8d')).toEqual([255, 77, 141]);
    expect(hexToRgb('#abc')).toEqual([170, 187, 204]);
    expect(hexToRgb('102030')).toEqual([16, 32, 48]);
  });

  it('rejects anything else', () => {
    expect(() => hexToRgb('#xyzxyz')).toThrow(/hex/i);
    expect(() => hexToRgb('#ff')).toThrow(/hex/i);
  });
});

describe('simplifyPath', () => {
  const line = Array.from({ length: 50 }, (_, i) => ({ x: i, y: 0 }));

  it('collapses a straight line to its endpoints', () => {
    expect(simplifyPath(line, 0.1)).toEqual([
      { x: 0, y: 0 },
      { x: 49, y: 0 },
    ]);
  });

  it('keeps everything at tolerance zero', () => {
    expect(simplifyPath(line, 0)).toHaveLength(50);
  });

  it('always keeps the first and last point', () => {
    const wiggly = Array.from({ length: 80 }, (_, i) => ({
      x: i,
      y: Math.sin(i / 3) * 4,
    }));
    const out = simplifyPath(wiggly, 1);
    expect(out[0]).toEqual(wiggly[0]);
    expect(out[out.length - 1]).toEqual(wiggly[wiggly.length - 1]);
    expect(out.length).toBeLessThan(wiggly.length);
  });

  it('keeps a corner that exceeds the tolerance', () => {
    const corner = [
      { x: 0, y: 0 },
      { x: 5, y: 10 },
      { x: 10, y: 0 },
    ];
    expect(simplifyPath(corner, 1)).toHaveLength(3);
    expect(simplifyPath(corner, 20)).toHaveLength(2);
  });
});

describe('renderSvg', () => {
  const svg = renderSvg(scene);

  it('emits a well-formed document with the right canvas', () => {
    expect(svg.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(svg).toContain('width="100" height="60"');
    expect(svg).toContain('viewBox="0 0 100 60"');
    expect(svg.trimEnd().endsWith('</svg>')).toBe(true);
  });

  it('paints the background and one group per layer', () => {
    expect(svg).toContain('<rect width="100" height="60" fill="#102030"/>');
    expect(svg.match(/<g /g)).toHaveLength(2);
    expect(svg).toContain('stroke="#ff4d8d"');
    expect(svg).toContain('stroke-opacity="0.8"');
  });

  it('never emits NaN or undefined coordinates', () => {
    expect(svg).not.toMatch(/NaN|undefined/);
  });

  it('embeds the seed and params as metadata', () => {
    expect(svg).toContain('<desc>');
    expect(svg).toContain('&quot;seed&quot;:&quot;test&quot;');
  });

  it('honours the precision setting', () => {
    const coarse = renderSvg(
      {
        ...scene,
        layers: [
          {
            color: '#000000',
            width: 1,
            opacity: 1,
            paths: [
              [
                { x: 1.23456, y: 2.34567 },
                { x: 40.5, y: 50.5 },
              ],
            ],
          },
        ],
      },
      { precision: 1, simplifyTolerance: 0 },
    );
    expect(coarse).toContain('M1.2 2.3L40.5 50.5');
  });

  it('closes a ring with Z instead of repeating the first point', () => {
    const ring: Scene = {
      ...scene,
      layers: [
        {
          color: '#000000',
          width: 1,
          opacity: 1,
          paths: [
            [
              { x: 0, y: 0 },
              { x: 10, y: 0 },
              { x: 10, y: 10 },
              { x: 0, y: 10 },
              { x: 0, y: 0 },
            ],
          ],
        },
      ],
    };
    const out = renderSvg(ring, { simplifyTolerance: 0 });
    expect(out).toContain('M0 0L10 0L10 10L0 10Z');
  });

  it('is deterministic', () => {
    expect(renderSvg(scene)).toBe(renderSvg(scene));
  });
});

describe('rasterize', () => {
  it('produces the requested dimensions and opaque pixels', () => {
    const r = rasterize(scene);
    expect(r.width).toBe(100);
    expect(r.height).toBe(60);
    expect(r.data).toHaveLength(100 * 60 * 4);
    for (let i = 3; i < r.data.length; i += 4) expect(r.data[i]).toBe(255);
  });

  it('fills the background where nothing is drawn', () => {
    const r = rasterize(scene);
    const corner = 0; // (0,0) is far from every stroke
    expect([r.data[corner], r.data[corner + 1], r.data[corner + 2]]).toEqual([
      16, 32, 48,
    ]);
  });

  it('draws strokes where the geometry says they are', () => {
    const r = rasterize(scene);
    const at = (x: number, y: number): number[] => {
      const o = (y * r.width + x) * 4;
      return [r.data[o]!, r.data[o + 1]!, r.data[o + 2]!];
    };
    // The second layer is a horizontal line at y = 50.
    expect(at(50, 50)).not.toEqual([16, 32, 48]);
    expect(at(50, 40)).toEqual([16, 32, 48]);
  });

  it('scales geometry up', () => {
    const r = rasterize(scene, 2);
    expect(r.width).toBe(200);
    expect(r.height).toBe(120);
  });

  it('is deterministic', () => {
    expect(Array.from(rasterize(scene).data)).toEqual(
      Array.from(rasterize(scene).data),
    );
  });
});

describe('downsample', () => {
  it('averages a block into one pixel', () => {
    const data = new Uint8ClampedArray([
      0, 0, 0, 255, 100, 100, 100, 255, 200, 200, 200, 255, 0, 0, 0, 255,
    ]);
    const out = downsample({ width: 2, height: 2, data }, 2);
    expect(out.width).toBe(1);
    expect(out.height).toBe(1);
    expect(out.data[0]).toBe(75); // (0 + 100 + 200 + 0) / 4
  });

  it('is a no-op at factor 1', () => {
    const r = rasterize(scene);
    expect(downsample(r, 1)).toBe(r);
  });

  it('rejects a non-integer factor', () => {
    const r: Raster = { width: 2, height: 2, data: new Uint8ClampedArray(16) };
    expect(() => downsample(r, 1.5)).toThrow(/integer/);
    expect(() => downsample(r, 0)).toThrow(/integer/);
  });
});

describe('deflate', () => {
  const cases: Array<[string, Uint8Array]> = [
    ['empty', new Uint8Array(0)],
    ['one byte', new Uint8Array([42])],
    ['all zeros', new Uint8Array(10000)],
    ['repeating', new Uint8Array(5000).map((_, i) => i % 7)],
    [
      'pseudo-random',
      (() => {
        let s = 12345;
        return new Uint8Array(20000).map(() => {
          s = (s * 1103515245 + 12345) & 0x7fffffff;
          return s & 0xff;
        });
      })(),
    ],
    [
      'long run then noise',
      (() => {
        const out = new Uint8Array(40000);
        for (let i = 20000; i < out.length; i++) out[i] = (i * 31) & 0xff;
        return out;
      })(),
    ],
  ];

  for (const [name, input] of cases) {
    it(`round-trips "${name}" through a real inflater`, () => {
      // node:zlib is the independent check: if our bitstream is wrong in any
      // way, inflate rejects it or returns different bytes.
      const out = inflateSync(Buffer.from(zlibCompress(input)));
      expect(Uint8Array.from(out)).toEqual(input);
    });
  }

  it('actually compresses compressible input', () => {
    const input = new Uint8Array(50000);
    expect(deflateRaw(input).length).toBeLessThan(input.length / 20);
  });

  it('is deterministic', () => {
    const input = new Uint8Array(3000).map((_, i) => (i * 13) & 0xff);
    expect(Array.from(zlibCompress(input))).toEqual(Array.from(zlibCompress(input)));
  });

  it('writes a valid zlib header', () => {
    const out = zlibCompress(new Uint8Array([1, 2, 3]));
    expect(out[0]).toBe(0x78);
    expect(((out[0]! << 8) | out[1]!) % 31).toBe(0);
  });

  it('computes adler32 correctly', () => {
    expect(adler32(new Uint8Array([97, 98, 99]))).toBe(0x024d0127); // "abc"
    expect(adler32(new Uint8Array(0))).toBe(1);
  });
});

describe('encodePng', () => {
  const raster = rasterize(scene);
  const png = encodePng(raster, { Software: 'fieldwork', Comment: 'seed=test' });

  it('starts with the PNG signature', () => {
    expect(Array.from(png.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  });

  it('declares the right dimensions and colour type in IHDR', () => {
    const view = new DataView(png.buffer, png.byteOffset);
    expect(view.getUint32(8)).toBe(13); // IHDR length
    expect(String.fromCharCode(...png.slice(12, 16))).toBe('IHDR');
    expect(view.getUint32(16)).toBe(100);
    expect(view.getUint32(20)).toBe(60);
    expect(png[24]).toBe(8); // bit depth
    expect(png[25]).toBe(6); // RGBA
  });

  it('ends with IEND', () => {
    const tail = String.fromCharCode(...png.slice(png.length - 8, png.length - 4));
    expect(tail).toBe('IEND');
  });

  it('carries the metadata as tEXt chunks', () => {
    const asString = Buffer.from(png).toString('latin1');
    expect(asString).toContain('tEXt');
    expect(asString).toContain('seed=test');
  });

  it('holds image data that inflates to the right number of scanlines', () => {
    const asString = Buffer.from(png).toString('latin1');
    const idatStart = asString.indexOf('IDAT') + 4;
    const lengthOffset = asString.indexOf('IDAT') - 4;
    const view = new DataView(png.buffer, png.byteOffset);
    const length = view.getUint32(lengthOffset);
    const raw = inflateSync(Buffer.from(png.slice(idatStart, idatStart + length)));
    // Each scanline is one filter byte plus width * 4 colour bytes.
    expect(raw.length).toBe((100 * 4 + 1) * 60);
    // Every filter byte must be a valid PNG filter type.
    for (let y = 0; y < 60; y++) {
      expect(raw[y * (100 * 4 + 1)]).toBeLessThanOrEqual(4);
    }
  });

  it('is deterministic', () => {
    expect(Array.from(encodePng(raster))).toEqual(Array.from(encodePng(raster)));
  });
});
