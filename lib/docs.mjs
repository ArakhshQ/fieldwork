// Reading uploaded résumés: PDF (sent to Claude), Word .docx (unzipped here) and plain text.
import { inflateRawSync } from 'node:zlib';

export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

/** Identify a file by its first bytes, not by its name. */
export function sniff(buf) {
  if (buf.length >= 5 && buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  if (buf.length >= 4 && buf.readUInt32LE(0) === 0x04034b50) return 'zip';
  // Treat as text only if it decodes cleanly and has no NUL bytes.
  if (!buf.includes(0)) return 'text';
  return 'unknown';
}

/** Read one file out of a ZIP archive using its central directory. */
export function unzipEntry(buf, name) {
  // End of central directory record: search backwards for its signature.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Not a valid Word file.');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count && p + 46 <= buf.length; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const compressed = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const entry = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    if (entry === name) {
      if (size > 20 * 1024 * 1024) throw new Error('This Word file is too large.');
      const lNameLen = buf.readUInt16LE(local + 26);
      const lExtraLen = buf.readUInt16LE(local + 28);
      const start = local + 30 + lNameLen + lExtraLen;
      const data = buf.subarray(start, start + compressed);
      if (method === 0) return data;
      if (method === 8) return inflateRawSync(data, { maxOutputLength: 20 * 1024 * 1024 });
      throw new Error('Unsupported Word file compression.');
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** Plain text from a .docx: paragraphs become lines, tabs stay tabs. */
export function docxText(buf) {
  const xml = unzipEntry(buf, 'word/document.xml');
  if (!xml) throw new Error('This doesn’t look like a Word (.docx) file.');
  return xml
    .toString('utf8')
    .replace(/<w:tab\/>/g, '\t')
    .replace(/<w:br\/>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(amp|lt|gt|quot|apos);/g, (_, e) => ENTITIES[e])
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
