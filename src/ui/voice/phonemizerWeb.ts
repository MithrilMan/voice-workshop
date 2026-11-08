import type { G2PNet, PhonemizerSources } from '../../dsp/speech/phonemizer';

/**
 * Where the browser gets the phonemizer's data, at the first use of a
 * language, never bundled with the site: the dictionaries from the ipa-dict
 * repository and the neural model from Hugging Face, both pinned to a
 * version. What arrives is kept in the browser's cache storage, so it is
 * downloaded once.
 */
const IPA_DICT = 'https://raw.githubusercontent.com/open-dict-data/ipa-dict/972cd67dd5f96bc5660e28070cde26e3928abcd7/data/';
/** CharsiuG2P, ByT5 tiny with 8 layers, 100 languages (MIT), in the ONNX format: 29 MB */
export const G2P_MODEL = 'https://huggingface.co/Jarbas/charsiu_g2p_multilingual_byT5_tiny_8_layers_100_onnx/resolve/db6dfca42b8236545f0ef8aa1d480999f2c10b40/charsiu_g2p_multilingual_byT5_tiny_8_layers_100.onnx';
const CACHE = 'voice-workshop-phonemizer-1';

async function openCache(): Promise<Cache | null> {
  try { return typeof caches === 'undefined' ? null : await caches.open(CACHE); } catch { return null; }
}

/** A file from the cache, or from the network (then cached), reporting the share downloaded. */
async function fetchOnce(url: string, progress?: (p: number) => void): Promise<ArrayBuffer> {
  const cache = await openCache();
  try {
    const hit = await cache?.match(url);
    if (hit) return await hit.arrayBuffer();
  } catch { /* a broken cache: download again */ }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  // the length of a compressed response counts compressed bytes: the share is an estimate, capped
  const total = Number(res.headers.get('content-length')) || 0;
  let buf: ArrayBuffer;
  if (res.body && total && progress) {
    const reader = res.body.getReader(), parts: Uint8Array[] = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value); got += value.length;
      progress(Math.min(0.99, got / total));
    }
    const all = new Uint8Array(got);
    let at = 0;
    for (const p of parts) { all.set(p, at); at += p.length; }
    buf = all.buffer;
  } else buf = await res.arrayBuffer();
  progress?.(1);
  try { await cache?.put(url, new Response(buf.slice(0))); } catch { /* full or private: next time downloads again */ }
  return buf;
}

let net: Promise<G2PNet> | null = null;

/** The model in ONNX Runtime (WebAssembly, one thread: the site is not cross-origin isolated). */
function loadNet(progress?: (p: number) => void): Promise<G2PNet> {
  net ??= (async () => {
    const [ort, wasm, bytes] = await Promise.all([
      import('onnxruntime-web/wasm'),
      import('onnxruntime-web/ort-wasm-simd-threaded.wasm?url'),
      fetchOnce(G2P_MODEL, progress),
    ]);
    ort.env.wasm.wasmPaths = { wasm: wasm.default };
    ort.env.wasm.numThreads = 1;
    const session = await ort.InferenceSession.create(new Uint8Array(bytes));
    const ids = (a: number[]) => new ort.Tensor('int64', BigInt64Array.from(a, BigInt), [1, a.length]);
    return {
      async next(input: number[], output: number[]): Promise<Float32Array> {
        const r = await session.run({ input_ids: ids(input), attention_mask: ids(input.map(() => 1)), decoder_input_ids: ids(output) }, ['logits']);
        const logits = r.logits, v = logits.dims[2];
        return (logits.data as Float32Array).slice((output.length - 1) * v, output.length * v);
      },
    };
  })();
  net.catch(() => { net = null; }); // a failed download can be tried again
  return net;
}

/** The model is not downloaded unasked: it is 29 MB. */
export class NeedsDownload extends Error {}

async function modelAtHand(): Promise<boolean> {
  if (net) return true;
  try { return !!(await (await openCache())?.match(G2P_MODEL)); } catch { return false; }
}

/** The sources of the phonemizer; without `download` the model is used only if it is already here. */
export function phonemizerSources(progress?: (p: number) => void, download = false): PhonemizerSources {
  return {
    dictionary: async (file) => new TextDecoder().decode(await fetchOnce(IPA_DICT + file + '.txt', progress)),
    model: async () => {
      if (!download && !(await modelAtHand())) throw new NeedsDownload('the model is not downloaded yet');
      return loadNet(progress);
    },
  };
}
