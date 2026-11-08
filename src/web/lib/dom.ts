const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

/** Tagged template that escapes every interpolation unless it is wrapped in raw(). */
export class Raw { constructor(public v: string) {} }
export const raw = (v: string) => new Raw(v);
export function html(strings: TemplateStringsArray, ...vals: unknown[]): string {
  let out = strings[0];
  vals.forEach((v, i) => {
    if (v instanceof Raw) out += v.v;
    else if (Array.isArray(v)) out += v.map((x) => (x instanceof Raw ? x.v : esc(x))).join('');
    else if (v !== false && v != null) out += esc(v);
    out += strings[i + 1];
  });
  return out;
}

export const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T;
export const $$ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => [...root.querySelectorAll(sel)] as T[];

const dateFmt = new Intl.DateTimeFormat('zh-Hant-TW', { year: 'numeric', month: '2-digit', day: '2-digit' });
export const fmtDate = (d: string | Date) => dateFmt.format(new Date(d)).replaceAll('/', '.');
const rel = new Intl.RelativeTimeFormat('zh-Hant-TW', { numeric: 'auto' });
export function ago(d: string | Date): string {
  const s = (new Date(d).getTime() - Date.now()) / 1000;
  const a = Math.abs(s);
  if (a < 60) return rel.format(Math.round(s), 'second');
  if (a < 3600) return rel.format(Math.round(s / 60), 'minute');
  if (a < 86400) return rel.format(Math.round(s / 3600), 'hour');
  if (a < 2592000) return rel.format(Math.round(s / 86400), 'day');
  if (a < 31536000) return rel.format(Math.round(s / 2592000), 'month');
  return rel.format(Math.round(s / 31536000), 'year');
}

export const pad = (n: number, w = 3) => String(n).padStart(w, '0');
export const roman = (n: number) => ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'][n] ?? String(n);

/** Fast enough CJK-aware length: counts Han characters and Latin words. */
export function wordCount(md: string): number {
  const text = md.replace(/```[\s\S]*?```/g, '').replace(/[#>*_`|\-[\]()^]/g, ' ');
  const han = text.match(/\p{Script=Han}/gu)?.length ?? 0;
  const latin = text.replace(/\p{Script=Han}/gu, ' ').match(/[A-Za-z0-9]+/g)?.length ?? 0;
  return han + latin;
}
export const readMinutes = (md: string) => Math.max(1, Math.round(wordCount(md) / 400));
