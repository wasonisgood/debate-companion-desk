/// <reference lib="webworker" />
/**
 * On-device speech recognition (Whisper via transformers.js) for browsers
 * without the Web Speech API — Firefox, some Safari / iOS setups, in-app
 * browsers. Runs on WebGPU when the browser has it, otherwise WebAssembly.
 * The model is downloaded once and kept in the browser cache.
 *
 *   → { type: 'load' }                               ← { type: 'progress', p, file } … { type: 'ready', device, model }
 *   → { type: 'run', id, audio: Float32Array(16 kHz), prompt }   ← { type: 'text', id, text } | { type: 'error', id, message }
 */
export {};
import { pipeline, env, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers';

env.allowLocalModels = false;

let asr: Promise<AutomaticSpeechRecognitionPipeline> | null = null;
let device: 'webgpu' | 'wasm' = 'wasm';
let model = '';

async function load(): Promise<AutomaticSpeechRecognitionPipeline> {
  const gpu = (self.navigator as any).gpu;
  try {
    if (gpu && (await gpu.requestAdapter())) device = 'webgpu';
  } catch {}
  // base.en on a GPU, tiny.en (≈40 MB) on the CPU so it keeps up with speech
  model = device === 'webgpu' ? 'onnx-community/whisper-base.en' : 'onnx-community/whisper-tiny.en';
  const progress_callback = (e: any) => {
    if (e?.status === 'progress') self.postMessage({ type: 'progress', p: e.progress ?? 0, file: e.file ?? '' });
  };
  const opts: any = device === 'webgpu'
    ? { device: 'webgpu', dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' }, progress_callback }
    : { device: 'wasm', dtype: 'q8', progress_callback };
  return (await pipeline('automatic-speech-recognition', model, opts)) as AutomaticSpeechRecognitionPipeline;
}

self.onmessage = async ({ data: m }) => {
  if (m.type === 'load') {
    try {
      asr ??= load();
      await asr;
      self.postMessage({ type: 'ready', device, model });
    } catch (e: any) {
      asr = null;
      self.postMessage({ type: 'error', id: -1, message: String(e?.message ?? e) });
    }
    return;
  }
  if (m.type === 'run') {
    try {
      asr ??= load();
      const p = await asr;
      const out: any = await p(m.audio as Float32Array, { chunk_length_s: 30, stride_length_s: 5 } as any);
      const text = (Array.isArray(out) ? out.map((x: any) => x.text).join(' ') : out?.text ?? '').trim();
      self.postMessage({ type: 'text', id: m.id, text });
    } catch (e: any) {
      self.postMessage({ type: 'error', id: m.id, message: String(e?.message ?? e) });
    }
  }
};
