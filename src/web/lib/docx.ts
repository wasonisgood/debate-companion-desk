/**
 * Word (.docx) in and out, with no dependencies.
 *
 *   readDocx(buf)      → blocks in reading order: paragraphs (with style / heading
 *                        level / list flag) and tables (rows × cells of text)
 *   buildDocx(blocks)  → a minimal, valid .docx Blob (headings, paragraphs, tables)
 *   fileToBlocks(file) → .docx / .pdf / .txt / .md, whatever the team drops in
 *
 * A .docx is a zip; we read it with the browser's DecompressionStream
 * ('deflate-raw') and write it uncompressed (store), which Word opens fine.
 */

export type Block =
  | { kind: 'p'; text: string; style: string; level: number; list: boolean }
  | { kind: 'table'; rows: string[][] };

/* ------------------------------------------------------------------ zip */

const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Read the named entries of a zip archive (all entries when `want` is omitted). */
export async function unzip(buf: ArrayBuffer | Uint8Array, want?: (name: string) => boolean): Promise<Map<string, Uint8Array>> {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  // end of central directory: scan back from the end
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65_557); i--) {
    if (u32(b, i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('不是有效的 Word 檔（找不到 zip 目錄）。');
  const count = u16(b, eocd + 10);
  let p = u32(b, eocd + 16);
  const out = new Map<string, Uint8Array>();
  const dec = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (u32(b, p) !== 0x02014b50) break;
    const method = u16(b, p + 10);
    const csize = u32(b, p + 20);
    const nlen = u16(b, p + 28);
    const xlen = u16(b, p + 30);
    const clen = u16(b, p + 32);
    const local = u32(b, p + 42);
    const name = dec.decode(b.subarray(p + 46, p + 46 + nlen));
    p += 46 + nlen + xlen + clen;
    if (want && !want(name)) continue;
    const lnlen = u16(b, local + 26);
    const lxlen = u16(b, local + 28);
    const start = local + 30 + lnlen + lxlen;
    const raw = b.subarray(start, start + csize);
    if (method === 0) out.set(name, raw.slice());
    else if (method === 8) out.set(name, await inflateRaw(raw));
  }
  return out;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(d: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < d.length; i++) c = CRC_TABLE[(c ^ d[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Stored (uncompressed) zip. */
export function zip(files: [string, string | Uint8Array][]): Uint8Array {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let off = 0;
  for (const [name, content] of files) {
    const data = typeof content === 'string' ? enc.encode(content) : content;
    const nm = enc.encode(name);
    const crc = crc32(data);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true);
    h.setUint16(8, 0, true); h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true);
    h.setUint16(26, nm.length, true);
    parts.push(new Uint8Array(h.buffer), nm, data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true);
    c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true);
    c.setUint16(28, nm.length, true); c.setUint32(42, off, true);
    central.push(new Uint8Array(c.buffer), nm);
    off += 30 + nm.length + data.length;
  }
  const cdSize = central.reduce((s, x) => s + x.length, 0);
  const e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
  e.setUint32(12, cdSize, true); e.setUint32(16, off, true);
  const all = [...parts, ...central, new Uint8Array(e.buffer)];
  const out = new Uint8Array(all.reduce((s, x) => s + x.length, 0));
  let o = 0;
  for (const x of all) { out.set(x, o); o += x.length; }
  return out;
}

/* ------------------------------------------------------------------ read */

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function paraText(p: Element): string {
  let s = '';
  const walk = (n: Element) => {
    for (const c of Array.from(n.children)) {
      const ln = c.localName;
      if (ln === 't') s += c.textContent ?? '';
      else if (ln === 'tab') s += '\t';
      else if (ln === 'br' || ln === 'cr') s += '\n';
      else if (ln === 'noBreakHyphen') s += '-';
      else if (ln === 'del' || ln === 'instrText' || ln === 'delText' || ln === 'rPr' || ln === 'pPr') continue; // tracked deletions are not text
      else walk(c);
    }
  };
  walk(p);
  return s.replace(/ /g, ' ');
}

/** Heading level from the style id/name: Heading1, 標題 1, Title… (0 = body). */
function headingLevel(styleId: string, names: Map<string, string>, outline: string | null): number {
  if (outline != null && /^\d$/.test(outline)) return Number(outline) + 1;
  const name = (names.get(styleId) ?? styleId).toLowerCase().replace(/\s+/g, '');
  if (name === 'title') return 1;
  const m = /^(heading|標題|title)(\d)$/.exec(name);
  return m ? Number(m[2]) : 0;
}

function dir(el: Element, name: string): Element[] {
  return Array.from(el.children).filter((c) => c.localName === name);
}
function attr(el: Element | undefined | null, name: string): string | null {
  return el ? el.getAttributeNS(W, name) ?? el.getAttribute(`w:${name}`) : null;
}

export async function readDocx(buf: ArrayBuffer | Uint8Array): Promise<Block[]> {
  const files = await unzip(buf, (n) => n === 'word/document.xml' || n === 'word/styles.xml');
  const doc = files.get('word/document.xml');
  if (!doc) throw new Error('Word 檔裡找不到內文（word/document.xml）。');
  const dec = new TextDecoder();
  const parser = new DOMParser();
  const names = new Map<string, string>();
  const outlines = new Map<string, string>();
  const st = files.get('word/styles.xml');
  if (st) {
    const sx = parser.parseFromString(dec.decode(st), 'application/xml');
    for (const s of Array.from(sx.getElementsByTagNameNS(W, 'style'))) {
      const id = attr(s, 'styleId') ?? '';
      const nm = s.getElementsByTagNameNS(W, 'name')[0];
      if (nm) names.set(id, attr(nm, 'val') ?? id);
      const ol = s.getElementsByTagNameNS(W, 'outlineLvl')[0];
      if (ol) outlines.set(id, attr(ol, 'val') ?? '');
    }
  }
  const x = parser.parseFromString(dec.decode(doc), 'application/xml');
  const body = x.getElementsByTagNameNS(W, 'body')[0];
  if (!body) return [];
  const out: Block[] = [];
  const para = (p: Element): Block => {
    const ppr = dir(p, 'pPr')[0];
    const style = attr(ppr ? dir(ppr, 'pStyle')[0] : null, 'val') ?? '';
    const ol = attr(ppr ? dir(ppr, 'outlineLvl')[0] : null, 'val') ?? outlines.get(style) ?? null;
    const list = !!(ppr && dir(ppr, 'numPr').length) || /list/i.test(names.get(style) ?? style);
    return { kind: 'p', text: paraText(p).trim(), style: names.get(style) ?? style, level: headingLevel(style, names, ol), list };
  };
  const cellText = (tc: Element): string =>
    Array.from(tc.getElementsByTagNameNS(W, 'p')).map((p) => paraText(p).trim()).filter(Boolean).join('\n');
  const walk = (parent: Element) => {
    for (const c of Array.from(parent.children)) {
      if (c.localName === 'p') out.push(para(c));
      else if (c.localName === 'tbl') {
        const rows = dir(c, 'tr').map((tr) => dir(tr, 'tc').map(cellText));
        out.push({ kind: 'table', rows });
      } else if (c.localName === 'sdt') {
        const content = dir(c, 'sdtContent')[0];
        if (content) walk(content);
      }
    }
  };
  walk(body);
  return out;
}

/* ------------------------------------------------------------------ write */

const xesc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
function run(text: string, props = ''): string {
  return text.split('\n').map((line, i) => `${i ? '<w:r><w:br/></w:r>' : ''}<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ''}<w:t xml:space="preserve">${xesc(line)}</w:t></w:r>`).join('');
}

export type OutBlock =
  | { kind: 'h'; level: 1 | 2 | 3; text: string }
  | { kind: 'p'; text: string; note?: boolean }
  | { kind: 'table'; rows: string[][] };

export function buildDocx(blocks: OutBlock[]): Blob {
  const bodyXml = blocks.map((b) => {
    if (b.kind === 'h') return `<w:p><w:pPr><w:pStyle w:val="Heading${b.level}"/></w:pPr>${run(b.text)}</w:p>`;
    if (b.kind === 'p') return `<w:p>${b.note ? '<w:pPr><w:pStyle w:val="Note"/></w:pPr>' : ''}${run(b.text)}</w:p>`;
    const rows = b.rows.map((r, ri) => `<w:tr>${r.map((c) => `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr>${(c || ' ').split('\n').map((l) => `<w:p>${run(l, ri === 0 ? '<w:b/>' : '')}</w:p>`).join('')}</w:tc>`).join('')}</w:tr>`).join('');
    return `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/><w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map((s) => `<w:${s} w:val="single" w:sz="4" w:space="0" w:color="999999"/>`).join('')}</w:tblBorders></w:tblPr>${rows}</w:tbl><w:p/>`;
  }).join('');
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${W}"><w:body>${bodyXml}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1200" w:right="1200" w:bottom="1200" w:left="1200" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const font = '<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="Microsoft JhengHei"/>';
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="${W}">
<w:docDefaults><w:rPrDefault><w:rPr>${font}<w:sz w:val="24"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="300" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
${[1, 2, 3].map((l) => `<w:style w:type="paragraph" w:styleId="Heading${l}"><w:name w:val="heading ${l}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="${360 - l * 60}" w:after="120"/><w:outlineLvl w:val="${l - 1}"/></w:pPr><w:rPr><w:b/><w:sz w:val="${36 - l * 4}"/></w:rPr></w:style>`).join('')}
<w:style w:type="paragraph" w:styleId="Note"><w:name w:val="Note"/><w:basedOn w:val="Normal"/><w:rPr><w:color w:val="666666"/><w:sz w:val="20"/></w:rPr></w:style>
<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/></w:style>
</w:styles>`;
  const ct = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;
  const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
  const bytes = zip([
    ['[Content_Types].xml', ct],
    ['_rels/.rels', rels],
    ['word/document.xml', document],
    ['word/_rels/document.xml.rels', docRels],
    ['word/styles.xml', styles],
  ]);
  return new Blob([bytes as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}

export function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1500);
}

/* ------------------------------------------------------------------ any file */

/**
 * PDF text. Lines are grouped by baseline; with `lines` each line is a block,
 * otherwise lines are merged into paragraphs at vertical gaps and at numbered
 * starts ("12.", "[3]", "A."). Small print (footnotes) is marked style 'small';
 * running page markers ("P.1/13", "Page 4 of 16") are dropped.
 */
async function readPdf(buf: ArrayBuffer, lines = false): Promise<Block[]> {
  const pdfjs = await import('pdfjs-dist');
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
  type Line = { y: number; h: number; text: string };
  const pages: Line[][] = [];
  const heights: number[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    const raw: { y: number; h: number; parts: { x: number; s: string; h: number }[] }[] = [];
    for (const it of tc.items as any[]) {
      if (typeof it.str !== 'string' || !it.str.trim()) continue;
      const x = it.transform[4];
      const y = it.transform[5];
      const h = Math.abs(it.height) || Math.abs(it.transform[3]) || 10;
      let line = raw.find((l) => Math.abs(l.y - y) < Math.max(h, l.h) * 0.45);
      if (!line) raw.push((line = { y, h, parts: [] }));
      line.parts.push({ x, s: it.str, h });
      line.h = Math.max(line.h, h);
    }
    raw.sort((a, b) => b.y - a.y);
    // Footnotes: a line that opens with a superscript number (small glyphs) at
    // the margin starts the note area; everything below it on the page is notes.
    // Superscript note references inside body lines become "^n".
    let inNotes = false;
    const ls = raw
      .map((l) => {
        const parts = l.parts.sort((a, b) => a.x - b.x);
        const sup = (p: { s: string; h: number }) => /^\s*\d{1,3}\s*$/.test(p.s) && p.h < l.h * 0.75;
        const opens = parts.length > 1 && sup(parts[0]);
        if (opens) inNotes = true;
        const text = parts.map((p, k) => (sup(p) ? (k === 0 && opens ? `${p.s.trim()} ` : `^${p.s.trim()}`) : p.s)).join(' ')
          .replace(/\s+\^/g, '^').replace(/\s+/g, ' ').trim()
          // small caps set as a capital plus smaller capitals: "M EMORIAL F OR" → "MEMORIAL FOR"
          .replace(/\b([A-Z]) (?=[A-Z]{2,}\b)/g, (m, c, off, all) => (/[a-z]/.test(all) ? m : c));
        return { y: l.y, h: inNotes ? l.h * 0.6 : l.h, text };
      })
      .filter((l) => l.text && !/^(P\.?\s*\d+\s*\/\s*\d+|Page \d+ of \d+.*)$/i.test(l.text) && !(/^\d{1,3}$/.test(l.text) && l.y < 50));
    ls.forEach((l) => heights.push(l.h));
    pages.push(ls);
  }
  const body = heights.sort((a, b) => a - b)[Math.floor(heights.length / 2)] || 10;
  const out: Block[] = [];
  const mk = (text: string, h: number): Block => ({ kind: 'p', text: text.replace(/\s+/g, ' ').trim(), style: h < body * 0.88 ? 'small' : '', level: 0, list: false });
  for (const ls of pages) {
    if (lines) { ls.forEach((l) => out.push(mk(l.text, l.h))); out.push(mk('', body)); continue; }
    let cur = '';
    let curH = body;
    let prev: Line | null = null;
    const flush = () => { if (cur.trim()) out.push(mk(cur, curH)); cur = ''; };
    for (const l of ls) {
      const gap = prev ? prev.y - l.y : 0;
      const small = l.h < body * 0.88;
      const sizeChange = prev && small !== prev.h < body * 0.88;
      const footStart = small && /^\d{1,3}$/.test(l.text);
      if (prev && (sizeChange || footStart || gap > Math.max(l.h, prev.h) * 1.9 || /^(\[\d+\]|\d{1,3}\.|[IVX]+\.|[A-H]\.|[a-h]\.|¶)\s/.test(l.text))) flush();
      if (!cur) curH = l.h;
      cur += (cur ? ' ' : '') + l.text;
      prev = l;
    }
    flush();
  }
  return out;
}

/** PDF as one block per printed line (schedules, tables). */
export async function pdfLines(file: File | Blob): Promise<Block[]> {
  return readPdf(await file.arrayBuffer(), true);
}

export async function fileToBlocks(file: File | Blob, name = (file as File).name ?? ''): Promise<Block[]> {
  const buf = await file.arrayBuffer();
  const lower = name.toLowerCase();
  const head = new Uint8Array(buf.slice(0, 5));
  if (lower.endsWith('.pdf') || (head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46)) return readPdf(buf);
  if (lower.endsWith('.docx') || (head[0] === 0x50 && head[1] === 0x4b)) return readDocx(buf);
  if (lower.endsWith('.doc')) throw new Error('舊版 .doc 格式無法讀取，請在 Word 另存成 .docx。');
  return textToBlocks(new TextDecoder().decode(buf));
}

/** Plain text / text pasted from Word: one block per line, markdown headings kept. */
export function textToBlocks(t: string): Block[] {
  return t.replace(/\r\n?/g, '\n').split('\n').map((line): Block => {
    const m = /^(#{1,3})\s+(.*)$/.exec(line.trim());
    if (m) return { kind: 'p', text: m[2].trim(), style: '', level: m[1].length, list: false };
    return { kind: 'p', text: line.trim(), style: '', level: 0, list: /^\s*([-•●▪]|\d+[.)])\s+/.test(line) };
  });
}

export const blocksText = (blocks: Block[]) =>
  blocks.map((b) => (b.kind === 'p' ? b.text : b.rows.map((r) => r.join(' | ')).join('\n'))).filter(Boolean).join('\n');
