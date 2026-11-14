/* eslint-disable no-restricted-globals */
/**
 * ZARKHEZ On-Device Plant Disease ONNX Inference Worker
 *
 * Runs strictly off the main UI thread using ONNX Runtime Web (WASM).
 * Expects preprocessed NCHW Float32Array [1, 3, 224, 224] or runs preprocessing from ImageData/RGBA.
 */

const CACHE_NAME = 'zarkhez-offline-models-v1';
const MODEL_CACHE_URL = '/_offline/models/plantvillage-mobilenetv2-q8.onnx';

let ortModule = null;
let sessionPromise = null;

async function ensureOrt() {
  if (ortModule) return ortModule;
  const imported = await import('/onnxruntime/ort.wasm.bundle.min.mjs');
  const ort = imported.default || imported;
  if (ort && ort.env && ort.env.wasm) {
    ort.env.wasm.wasmPaths = '/onnxruntime/';
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.proxy = false;
  }
  ortModule = ort;
  return ort;
}

async function loadCachedModelBuffer(customBuffer) {
  if (customBuffer && customBuffer.byteLength > 1000) {
    return customBuffer;
  }
  if (typeof caches === 'undefined') {
    throw new Error('Cache API unavailable in worker context');
  }
  const cache = await caches.open(CACHE_NAME);
  const res = await cache.match(MODEL_CACHE_URL);
  if (!res) {
    throw new Error('Offline ONNX vision model is not installed yet');
  }
  return res.arrayBuffer();
}

async function getSession(customBuffer) {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      const ort = await ensureOrt();
      const buffer = await loadCachedModelBuffer(customBuffer);
      const bytes = new Uint8Array(buffer);
      return ort.InferenceSession.create(bytes, {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all',
      });
    })().catch((err) => {
      sessionPromise = null;
      throw err;
    });
  }
  return sessionPromise;
}

function softmax(logits) {
  let maxLogit = -Infinity;
  for (let i = 0; i < logits.length; i++) {
    if (logits[i] > maxLogit) maxLogit = logits[i];
  }
  const exps = new Float32Array(logits.length);
  let sum = 0;
  for (let i = 0; i < logits.length; i++) {
    const val = Math.exp(logits[i] - maxLogit);
    exps[i] = val;
    sum += val;
  }
  if (sum > 0) {
    for (let i = 0; i < exps.length; i++) {
      exps[i] /= sum;
    }
  }
  return exps;
}

self.onmessage = async (event) => {
  const { id, type, tensorBuffer, modelBuffer } = event.data || {};
  if (type === 'DISPOSE') {
    try {
      const existing = await sessionPromise?.catch(() => null);
      if (existing && typeof existing.release === 'function') {
        await existing.release();
      }
    } catch {
      /* ignore session release failure */
    }
    sessionPromise = null;
    self.postMessage({ id, ok: true });
    return;
  }

  if (type === 'WARM_VISION_MODEL') {
    try {
      await getSession(modelBuffer);
      self.postMessage({ id, ok: true, backend: 'wasm' });
    } catch (err) {
      self.postMessage({
        id,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return;
  }

  if (type === 'RUN_VISION_INFERENCE') {
    const startedAt = Date.now();
    let tensor = null;
    try {
      const ort = await ensureOrt();
      const session = await getSession(modelBuffer);
      const inputName = session.inputNames[0];
      const outputName = session.outputNames[0];
      const floatData = new Float32Array(tensorBuffer);
      if (floatData.length !== 3 * 224 * 224) {
        throw new Error(`Invalid tensor length (${floatData.length})`);
      }
      tensor = new ort.Tensor('float32', floatData, [1, 3, 224, 224]);
      const outputs = await session.run({ [inputName]: tensor });
      const rawLogits = outputs[outputName].data;
      const probs = softmax(rawLogits);

      const indexed = Array.from(probs, (prob, idx) => ({ idx, prob })).sort(
        (a, b) => b.prob - a.prob
      );

      self.postMessage({
        id,
        ok: true,
        backend: 'wasm',
        latencyMs: Date.now() - startedAt,
        topPredictions: indexed.slice(0, 5),
      });
    } catch (err) {
      self.postMessage({
        id,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      if (tensor && typeof tensor.dispose === 'function') {
        try {
          tensor.dispose();
        } catch {
          /* ignore */
        }
      }
    }
  }
};
