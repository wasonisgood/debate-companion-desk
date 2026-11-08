/**
 * Four ways to reach a language model that is not in the cloud. Every one of
 * them ends up as the same thing: an async iterable of text deltas.
 */
export type Backend = 'ollama' | 'openai' | 'webgpu' | 'builtin';
export interface Settings { backend: Backend; base: string; model: string; key: string; temperature: number; system: string; }
/** `images` are base64 JPEG/PNG bytes (no data: prefix). Backends without vision ignore them. */
export interface Msg { role: 'system' | 'user' | 'assistant'; content: string; images?: string[]; }

/** Vision-capable request shapes per backend. WebGPU models here are text-only. */
const forOllama = (ms: Msg[]) => ms.map((m) => (m.images?.length ? { role: m.role, content: m.content, images: m.images } : { role: m.role, content: m.content }));
const forOpenAI = (ms: Msg[]) => ms.map((m) => (m.images?.length
  ? { role: m.role, content: [{ type: 'text', text: m.content }, ...m.images.map((b) => ({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${b}` } }))] }
  : { role: m.role, content: m.content }));
const textOnly = (ms: Msg[]) => ms.map((m) => ({ role: m.role, content: m.content }));

export const DEFAULT_BASE: Record<Backend, string> = {
  ollama: 'http://localhost:11434',
  openai: 'http://localhost:1234/v1',
  webgpu: '',
  builtin: '',
};
export const LABEL: Record<Backend, string> = {
  ollama: 'Ollama',
  openai: 'OpenAI 相容（LM Studio / llama.cpp）',
  webgpu: 'WebGPU · 瀏覽器內',
  builtin: '瀏覽器內建模型',
};

const KEY = 'llm-settings';
export function loadSettings(): Settings {
  const d: Settings = { backend: 'ollama', base: DEFAULT_BASE.ollama, model: '', key: '', temperature: 0.7, system: '用繁體中文回答，簡潔、具體。' };
  try { return { ...d, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }; } catch { return d; }
}
export function saveSettings(s: Settings) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {} }
export const describe = (s: Settings) => `${LABEL[s.backend]}${s.model ? ` · ${s.model}` : ''}`;

// ---------- stream plumbing ----------
/** Splits a text stream into lines, holding back the partial tail. */
const lines = () => {
  let buf = '';
  return new TransformStream<string, string>({
    transform(chunk, ctl) {
      buf += chunk;
      const parts = buf.split(/\r?\n/);
      buf = parts.pop()!;
      for (const p of parts) if (p.trim()) ctl.enqueue(p);
    },
    flush(ctl) { if (buf.trim()) ctl.enqueue(buf); },
  });
};

async function* readLines(res: Response): AsyncGenerator<string> {
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${(await res.text()).slice(0, 200)}`);
  const reader = res.body!.pipeThrough(new TextDecoderStream()).pipeThrough(lines()).getReader();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      yield value;
    }
  } finally { reader.releaseLock(); }
}

const trimSlash = (s: string) => s.replace(/\/+$/, '');

// ---------- Ollama: NDJSON ----------
async function* ollama(s: Settings, messages: Msg[], signal: AbortSignal) {
  const res = await fetch(`${trimSlash(s.base)}/api/chat`, {
    method: 'POST', signal,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: s.model, messages: forOllama(messages), stream: true, options: { temperature: s.temperature } }),
  });
  for await (const line of readLines(res)) {
    const j = JSON.parse(line);
    if (j.error) throw new Error(j.error);
    if (j.message?.content) yield j.message.content as string;
    if (j.done) return;
  }
}

// ---------- OpenAI-compatible: Server-Sent Events ----------
async function* openai(s: Settings, messages: Msg[], signal: AbortSignal) {
  const res = await fetch(`${trimSlash(s.base)}/chat/completions`, {
    method: 'POST', signal,
    headers: { 'content-type': 'application/json', ...(s.key ? { authorization: `Bearer ${s.key}` } : {}) },
    body: JSON.stringify({ model: s.model, messages: forOpenAI(messages), stream: true, temperature: s.temperature }),
  });
  for await (const line of readLines(res)) {
    if (!line.startsWith('data:')) continue;
    const data = line.slice(5).trim();
    if (data === '[DONE]') return;
    const j = JSON.parse(data);
    const t = j.choices?.[0]?.delta?.content;
    if (t) yield t as string;
  }
}

// ---------- WebGPU via WebLLM (lazy, large) ----------
let engine: { id: string; e: any } | null = null;
export type Progress = (p: { progress: number; text: string }) => void;
let onProgress: Progress = () => {};
export const setProgress = (fn: Progress) => { onProgress = fn; };

export async function webgpuModels(): Promise<{ id: string; mb: number }[]> {
  const { prebuiltAppConfig } = await import('@mlc-ai/web-llm');
  return prebuiltAppConfig.model_list
    .filter((m: any) => (m.vram_required_MB ?? 9e9) < 3200 && /instruct|chat|it-/i.test(m.model_id))
    .map((m: any) => ({ id: m.model_id as string, mb: Math.round(m.vram_required_MB) }))
    .sort((a, b) => a.mb - b.mb);
}

async function* webgpu(s: Settings, messages: Msg[], signal: AbortSignal) {
  if (!('gpu' in navigator)) throw new Error('這個瀏覽器沒有 WebGPU');
  const webllm = await import('@mlc-ai/web-llm');
  if (!engine || engine.id !== s.model) {
    await engine?.e.unload?.();
    engine = { id: s.model, e: await webllm.CreateMLCEngine(s.model, { initProgressCallback: (r: any) => onProgress({ progress: r.progress, text: r.text }) }) };
  }
  const e = engine.e;
  const stop = () => e.interruptGenerate();
  signal.addEventListener('abort', stop, { once: true });
  try {
    const chunks = await e.chat.completions.create({ messages: textOnly(messages), stream: true, temperature: s.temperature });
    for await (const c of chunks) {
      const t = c.choices?.[0]?.delta?.content;
      if (t) yield t as string;
    }
    if (signal.aborted) throw new DOMException('aborted', 'AbortError');
  } finally { signal.removeEventListener('abort', stop); }
}

// ---------- Chrome built-in Prompt API ----------
async function* builtin(s: Settings, messages: Msg[], signal: AbortSignal) {
  const LM = (globalThis as any).LanguageModel;
  if (!LM) throw new Error('這個瀏覽器沒有內建模型（Prompt API）');
  const avail = await LM.availability();
  if (avail === 'unavailable') throw new Error('內建模型在這台裝置上無法使用');
  const history = textOnly(messages.slice(0, -1));
  const last = messages[messages.length - 1];
  const vision = !!last.images?.length;
  const session = await LM.create({
    signal,
    temperature: Math.max(0.1, s.temperature), topK: 3,
    initialPrompts: history,
    ...(vision ? { expectedInputs: [{ type: 'text' }, { type: 'image' }] } : {}),
    monitor(m: EventTarget) { m.addEventListener('downloadprogress', (ev: any) => onProgress({ progress: ev.loaded, text: '下載內建模型' })); },
  });
  try {
    const input = vision
      ? [{ role: 'user', content: [{ type: 'text', value: last.content }, ...await Promise.all(last.images!.map(async (b) => ({ type: 'image', value: await (await fetch(`data:image/jpeg;base64,${b}`)).blob() })))] }]
      : last.content;
    const stream: ReadableStream<string> = session.promptStreaming(input, { signal });
    const reader = stream.getReader();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      yield value;
    }
  } finally { session.destroy(); }
}

export function streamChat(s: Settings, messages: Msg[], signal: AbortSignal): AsyncGenerator<string> {
  if (s.backend !== 'builtin' && !s.model) throw new Error('還沒選模型');
  return { ollama, openai, webgpu, builtin }[s.backend](s, messages, signal);
}

export async function listModels(s: Settings, signal?: AbortSignal): Promise<string[]> {
  const base = trimSlash(s.base);
  if (s.backend === 'ollama') {
    const r = await fetch(`${base}/api/tags`, { signal });
    if (!r.ok) throw new Error(`${r.status}`);
    return ((await r.json()).models ?? []).map((m: any) => m.name);
  }
  if (s.backend === 'openai') {
    const r = await fetch(`${base}/models`, { signal, headers: s.key ? { authorization: `Bearer ${s.key}` } : {} });
    if (!r.ok) throw new Error(`${r.status}`);
    return ((await r.json()).data ?? []).map((m: any) => m.id);
  }
  if (s.backend === 'webgpu') return (await webgpuModels()).map((m) => m.id);
  return ['built-in'];
}
