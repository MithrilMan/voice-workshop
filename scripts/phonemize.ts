/**
 * The phonemizer outside the browser, with the real dictionary and model:
 *   npx tsx scripts/phonemize.ts <language> "<text>" ["<text>"...]
 * The model is downloaded once into out/g2p/, the dictionaries are fetched
 * each time. Prints the IPA the Speak panel would say, and where each word
 * came from.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import * as ort from 'onnxruntime-web';
import { phonemize, resolve, G2PNet } from '../src/dsp/speech/phonemizer';
import { G2P_MODEL } from '../src/ui/voice/phonemizerWeb';

const IPA_DICT = 'https://raw.githubusercontent.com/open-dict-data/ipa-dict/972cd67dd5f96bc5660e28070cde26e3928abcd7/data/';
const FILE = 'out/g2p/model.onnx';

async function net(): Promise<G2PNet> {
  if (!existsSync(FILE)) {
    mkdirSync('out/g2p', { recursive: true });
    const res = await fetch(G2P_MODEL);
    if (!res.ok) throw new Error(`model: HTTP ${res.status}`);
    writeFileSync(FILE, new Uint8Array(await res.arrayBuffer()));
  }
  ort.env.wasm.numThreads = 1;
  const session = await ort.InferenceSession.create(readFileSync(FILE));
  const ids = (a: number[]) => new ort.Tensor('int64', BigInt64Array.from(a, BigInt), [1, a.length]);
  return {
    async next(input, output) {
      const r = await session.run({ input_ids: ids(input), attention_mask: ids(input.map(() => 1)), decoder_input_ids: ids(output) }, ['logits']);
      const v = r.logits.dims[2];
      return (r.logits.data as Float32Array).slice((output.length - 1) * v, output.length * v);
    },
  };
}

const [lang, ...texts] = process.argv.slice(2);
let model: Promise<G2PNet> | null = null;
const sources = {
  dictionary: async (file: string) => {
    const res = await fetch(IPA_DICT + file + '.txt');
    if (!res.ok) throw new Error(`dictionary: HTTP ${res.status}`);
    return res.text();
  },
  model: () => (model ??= net()),
};
for (const text of texts) {
  const t0 = performance.now();
  await resolve(text, lang, sources);
  const r = phonemize(text, lang);
  const ipa = r.phones.map((p) => (p.stress ? 'ˈ' : '') + p.ipa + (p.long ? 'ː' : '') + (p.tone ? p.tone.join('') : '') + (p.wordEnd ? ' ' : '') + (p.pause ? (p.question ? '? ' : '| ') : '')).join('');
  console.log(`${lang} ${text}\n  ${ipa}\n  dictionary ${r.dictionaryWords}, model [${r.modelWords.join(', ')}]${r.numbers.length ? `, numbers [${r.numbers.join(', ')}]` : ''}, ${Math.round(performance.now() - t0)} ms`);
}
