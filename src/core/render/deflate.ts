/**
 * A small, fully deterministic DEFLATE compressor (RFC 1951) with a zlib
 * wrapper (RFC 1950).
 *
 * Why not `node:zlib`? Because this project promises that a seed produces
 * byte-identical output, and that promise has to survive a different machine
 * and a different Node build. Platform zlib is deterministic in practice but
 * not by contract — output has shifted between zlib and zlib-ng builds. This
 * implementation is ~200 lines and is deterministic by construction, which
 * also means the compressor runs unchanged in the browser.
 *
 * Strategy: greedy LZ77 over a 32 KiB window with hash chains, emitted with
 * DEFLATE's fixed Huffman tables. Dynamic tables would compress better; fixed
 * tables keep the code auditable and are plenty for flat-background art.
 */

const WINDOW_SIZE = 32768;
const MIN_MATCH = 3;
const MAX_MATCH = 258;
const HASH_BITS = 15;
const HASH_SIZE = 1 << HASH_BITS;
/** Chain walk limit: bounds worst-case time and keeps output reproducible. */
const MAX_CHAIN = 128;

// RFC 1951 section 3.2.5
const LENGTH_BASE = [
  3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115,
  131, 163, 195, 227, 258,
];
const LENGTH_EXTRA = [
  0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0,
];
const DIST_BASE = [
  1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537,
  2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577,
];
const DIST_EXTRA = [
  0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12,
  13, 13,
];

/** Fixed literal/length code table from RFC 1951 section 3.2.6. */
function buildFixedLiteralCodes(): { codes: Uint16Array; lengths: Uint8Array } {
  const codes = new Uint16Array(288);
  const lengths = new Uint8Array(288);
  for (let i = 0; i < 288; i++) {
    if (i <= 143) {
      codes[i] = 0x30 + i;
      lengths[i] = 8;
    } else if (i <= 255) {
      codes[i] = 0x190 + (i - 144);
      lengths[i] = 9;
    } else if (i <= 279) {
      codes[i] = i - 256;
      lengths[i] = 7;
    } else {
      codes[i] = 0xc0 + (i - 280);
      lengths[i] = 8;
    }
  }
  return { codes, lengths };
}

const FIXED = buildFixedLiteralCodes();

class BitWriter {
  private buf = new Uint8Array(1024);
  private len = 0;
  private cur = 0;
  private bitCount = 0;

  private push(byte: number): void {
    if (this.len === this.buf.length) {
      const grown = new Uint8Array(this.buf.length * 2);
      grown.set(this.buf);
      this.buf = grown;
    }
    this.buf[this.len++] = byte;
  }

  /** Non-Huffman fields: least-significant bit first. */
  bits(value: number, count: number): void {
    for (let i = 0; i < count; i++) {
      this.cur |= ((value >>> i) & 1) << this.bitCount;
      if (++this.bitCount === 8) {
        this.push(this.cur);
        this.cur = 0;
        this.bitCount = 0;
      }
    }
  }

  /** Huffman codes: most-significant bit first. */
  huffman(code: number, count: number): void {
    for (let i = count - 1; i >= 0; i--) {
      this.cur |= ((code >>> i) & 1) << this.bitCount;
      if (++this.bitCount === 8) {
        this.push(this.cur);
        this.cur = 0;
        this.bitCount = 0;
      }
    }
  }

  finish(): Uint8Array {
    if (this.bitCount > 0) this.push(this.cur);
    return this.buf.slice(0, this.len);
  }
}

function lengthCodeIndex(length: number): number {
  for (let i = LENGTH_BASE.length - 1; i >= 0; i--) {
    if (length >= LENGTH_BASE[i]!) return i;
  }
  return 0;
}

function distCodeIndex(dist: number): number {
  for (let i = DIST_BASE.length - 1; i >= 0; i--) {
    if (dist >= DIST_BASE[i]!) return i;
  }
  return 0;
}

/** Raw DEFLATE stream: one fixed-Huffman block covering the whole input. */
export function deflateRaw(input: Uint8Array): Uint8Array {
  const out = new BitWriter();
  out.bits(1, 1); // BFINAL
  out.bits(1, 2); // BTYPE = 01, fixed Huffman

  const emitLiteral = (byte: number): void => {
    out.huffman(FIXED.codes[byte]!, FIXED.lengths[byte]!);
  };

  const head = new Int32Array(HASH_SIZE).fill(-1);
  const prev = new Int32Array(input.length).fill(-1);
  const hashAt = (i: number): number =>
    ((input[i]! << 10) ^ (input[i + 1]! << 5) ^ input[i + 2]!) & (HASH_SIZE - 1);

  let pos = 0;
  while (pos < input.length) {
    let bestLength = 0;
    let bestDist = 0;

    if (pos + MIN_MATCH <= input.length) {
      const h = hashAt(pos);
      let candidate = head[h]!;
      let chain = 0;
      const maxLength = Math.min(MAX_MATCH, input.length - pos);
      while (candidate >= 0 && chain++ < MAX_CHAIN) {
        const dist = pos - candidate;
        if (dist > WINDOW_SIZE) break;
        let length = 0;
        while (length < maxLength && input[candidate + length] === input[pos + length]) {
          length++;
        }
        if (length > bestLength) {
          bestLength = length;
          bestDist = dist;
          if (length >= maxLength) break;
        }
        candidate = prev[candidate]!;
      }
    }

    if (bestLength >= MIN_MATCH) {
      const li = lengthCodeIndex(bestLength);
      const sym = 257 + li;
      out.huffman(FIXED.codes[sym]!, FIXED.lengths[sym]!);
      if (LENGTH_EXTRA[li]! > 0) out.bits(bestLength - LENGTH_BASE[li]!, LENGTH_EXTRA[li]!);
      const di = distCodeIndex(bestDist);
      out.huffman(di, 5);
      if (DIST_EXTRA[di]! > 0) out.bits(bestDist - DIST_BASE[di]!, DIST_EXTRA[di]!);

      // Insert every position inside the match so later matches can find them.
      for (let i = 0; i < bestLength; i++) {
        const p = pos + i;
        if (p + MIN_MATCH <= input.length) {
          const h = hashAt(p);
          prev[p] = head[h]!;
          head[h] = p;
        }
      }
      pos += bestLength;
    } else {
      emitLiteral(input[pos]!);
      if (pos + MIN_MATCH <= input.length) {
        const h = hashAt(pos);
        prev[pos] = head[h]!;
        head[h] = pos;
      }
      pos++;
    }
  }

  out.huffman(FIXED.codes[256]!, FIXED.lengths[256]!); // end of block
  return out.finish();
}

export function adler32(data: Uint8Array): number {
  let a = 1;
  let b = 0;
  // 5552 is the largest run that cannot overflow a 32-bit accumulator.
  for (let i = 0; i < data.length; ) {
    const end = Math.min(i + 5552, data.length);
    for (; i < end; i++) {
      a += data[i]!;
      b += a;
    }
    a %= 65521;
    b %= 65521;
  }
  return ((b << 16) | a) >>> 0;
}

/** zlib-wrapped DEFLATE stream, as PNG's IDAT requires. */
export function zlibCompress(input: Uint8Array): Uint8Array {
  const body = deflateRaw(input);
  const out = new Uint8Array(body.length + 6);
  out[0] = 0x78; // CM=8 (deflate), CINFO=7 (32 KiB window)
  out[1] = 0x01; // FCHECK chosen so (CMF<<8 | FLG) % 31 === 0
  out.set(body, 2);
  const sum = adler32(input);
  out[body.length + 2] = (sum >>> 24) & 0xff;
  out[body.length + 3] = (sum >>> 16) & 0xff;
  out[body.length + 4] = (sum >>> 8) & 0xff;
  out[body.length + 5] = sum & 0xff;
  return out;
}
