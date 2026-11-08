/**
 * Minimal PNG encoder: 8-bit RGBA, adaptive per-scanline filtering, and the
 * deterministic DEFLATE from ./deflate.
 */

import type { Raster } from './raster';
import { zlibCompress } from './deflate';

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function u32(value: number): Uint8Array {
  return new Uint8Array([
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ]);
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const body = new Uint8Array(4 + data.length);
  for (let i = 0; i < 4; i++) body[i] = type.charCodeAt(i);
  body.set(data, 4);
  const out = new Uint8Array(4 + body.length + 4);
  out.set(u32(data.length), 0);
  out.set(body, 4);
  out.set(u32(crc32(body)), 4 + body.length);
  return out;
}

function paethPredictor(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

const BPP = 4;

/**
 * Pick a filter per scanline using the heuristic from the PNG spec: minimise
 * the sum of absolute signed filtered values, which correlates well with how
 * much the row then compresses.
 */
function filterScanlines(raster: Raster): Uint8Array {
  const { width, height, data } = raster;
  const stride = width * BPP;
  const out = new Uint8Array((stride + 1) * height);
  const candidates = [0, 1, 2, 3, 4].map(() => new Uint8Array(stride));
  const prior = new Uint8Array(stride);
  const current = new Uint8Array(stride);

  for (let y = 0; y < height; y++) {
    current.set(data.subarray(y * stride, y * stride + stride));
    for (let i = 0; i < stride; i++) {
      const raw = current[i]!;
      const left = i >= BPP ? current[i - BPP]! : 0;
      const up = prior[i]!;
      const upLeft = i >= BPP ? prior[i - BPP]! : 0;
      candidates[0]![i] = raw;
      candidates[1]![i] = (raw - left) & 0xff;
      candidates[2]![i] = (raw - up) & 0xff;
      candidates[3]![i] = (raw - ((left + up) >> 1)) & 0xff;
      candidates[4]![i] = (raw - paethPredictor(left, up, upLeft)) & 0xff;
    }

    let best = 0;
    let bestScore = Infinity;
    for (let f = 0; f < 5; f++) {
      let score = 0;
      const c = candidates[f]!;
      for (let i = 0; i < stride; i++) {
        const v = c[i]!;
        score += v < 128 ? v : 256 - v;
      }
      if (score < bestScore) {
        bestScore = score;
        best = f;
      }
    }

    const rowStart = y * (stride + 1);
    out[rowStart] = best;
    out.set(candidates[best]!, rowStart + 1);
    prior.set(current);
  }
  return out;
}

function textChunk(keyword: string, text: string): Uint8Array {
  const kw = keyword.slice(0, 79);
  const bytes = new Uint8Array(kw.length + 1 + text.length);
  for (let i = 0; i < kw.length; i++) bytes[i] = kw.charCodeAt(i) & 0xff;
  bytes[kw.length] = 0;
  for (let i = 0; i < text.length; i++) bytes[kw.length + 1 + i] = text.charCodeAt(i) & 0xff;
  return chunk('tEXt', bytes);
}

/**
 * Encode RGBA pixels as a PNG. Any `text` entries become tEXt chunks, which
 * is how a rendered piece carries its own seed and params inside the file.
 */
export function encodePng(raster: Raster, text: Record<string, string> = {}): Uint8Array {
  const signature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdrData = new Uint8Array(13);
  ihdrData.set(u32(raster.width), 0);
  ihdrData.set(u32(raster.height), 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 6; // colour type: truecolour with alpha
  ihdrData[10] = 0; // compression: deflate
  ihdrData[11] = 0; // filter method: adaptive
  ihdrData[12] = 0; // interlace: none

  const parts: Uint8Array[] = [
    signature,
    chunk('IHDR', ihdrData),
    ...Object.entries(text).map(([k, v]) => textChunk(k, v)),
    chunk('IDAT', zlibCompress(filterScanlines(raster))),
    chunk('IEND', new Uint8Array(0)),
  ];

  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
