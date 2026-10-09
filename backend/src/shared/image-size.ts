// Image dimension reader (ported 1:1 from the original .mjs implementation)

export interface ImageDimensions {
  width: number;
  height: number;
  type: 'png' | 'jpeg' | 'gif' | 'webp';
}

function pngSize(buf: Buffer): ImageDimensions | null {
  if (buf.length < 24) return null;
  if (buf.toString('ascii', 1, 4) !== 'PNG') return null;
  if (buf[12] !== 0x49 || buf[13] !== 0x48 || buf[14] !== 0x44 || buf[15] !== 0x52) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), type: 'png' };
}

function jpegSize(buf: Buffer): ImageDimensions | null {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let off = 2;
  while (off + 9 < buf.length) {
    if (buf[off] !== 0xff) {
      off += 1;
      continue;
    }
    const marker = buf[off + 1]!;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      off += 2;
      continue;
    }
    const len = buf.readUInt16BE(off + 2);
    const isSOF =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSOF) {
      if (off + 9 >= buf.length) return null;
      return {
        height: buf.readUInt16BE(off + 5),
        width: buf.readUInt16BE(off + 7),
        type: 'jpeg',
      };
    }
    if (len < 2) return null;
    off += 2 + len;
  }
  return null;
}

function gifSize(buf: Buffer): ImageDimensions | null {
  if (buf.length < 10) return null;
  const sig = buf.toString('ascii', 0, 6);
  if (sig !== 'GIF87a' && sig !== 'GIF89a') return null;
  return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8), type: 'gif' };
}

function webpSize(buf: Buffer): ImageDimensions | null {
  if (buf.length < 30) return null;
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WEBP') return null;
  const fourcc = buf.toString('ascii', 12, 16);
  if (fourcc === 'VP8X') {
    const w = 1 + (buf[24]! | (buf[25]! << 8) | (buf[26]! << 16));
    const h = 1 + (buf[27]! | (buf[28]! << 8) | (buf[29]! << 16));
    return { width: w, height: h, type: 'webp' };
  }
  if (fourcc === 'VP8 ') {
    const w = buf.readUInt16LE(26) & 0x3fff;
    const h = buf.readUInt16LE(28) & 0x3fff;
    return { width: w, height: h, type: 'webp' };
  }
  if (fourcc === 'VP8L') {
    const b0 = buf[21]!;
    const b1 = buf[22]!;
    const b2 = buf[23]!;
    const b3 = buf[24]!;
    const w = 1 + (((b1 & 0x3f) << 8) | b0);
    const h = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
    return { width: w, height: h, type: 'webp' };
  }
  return null;
}

export function imageSize(buf: Buffer): ImageDimensions | null {
  if (!buf || buf.length < 12) return null;
  return pngSize(buf) || jpegSize(buf) || gifSize(buf) || webpSize(buf) || null;
}
