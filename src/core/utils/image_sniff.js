/**
 * Magic-byte image type detection.
 *
 * Client-supplied `file.mimetype` is attacker-controlled — a renamed
 * executable or HTML file can claim `image/png`. These signatures let us
 * verify the real content before storing or serving the file.
 */

const eq = (buf, offset, bytes) =>
  buf.length >= offset + bytes.length &&
  bytes.every((b, i) => buf[offset + i] === b);

const ASCII = (s) => [...s].map((c) => c.charCodeAt(0));

/**
 * Returns the real MIME type of the buffer, or null if it is not a
 * supported image.
 */
function sniffImageType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;

  // JPEG: FF D8 FF
  if (eq(buffer, 0, [0xff, 0xd8, 0xff])) return 'image/jpeg';

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (eq(buffer, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';

  // GIF: GIF87a / GIF89a
  if (eq(buffer, 0, ASCII('GIF87a')) || eq(buffer, 0, ASCII('GIF89a'))) return 'image/gif';

  // WEBP: RIFF????WEBP
  if (eq(buffer, 0, ASCII('RIFF')) && eq(buffer, 8, ASCII('WEBP'))) return 'image/webp';

  // AVIF/HEIC: ISO BMFF — bytes 4-7 are 'ftyp', brand at 8-11.
  if (eq(buffer, 4, ASCII('ftyp'))) {
    const brand = buffer.toString('ascii', 8, 12);
    if (brand === 'avif' || brand === 'avis') return 'image/avif';
  }

  return null;
}

module.exports = { sniffImageType };
