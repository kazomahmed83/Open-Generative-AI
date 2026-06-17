// lib/local-runtime/providers/comfyui.js
//
// Native ComfyUI provider: generates images by submitting a txt2img workflow to a locally-running
// ComfyUI server (default http://127.0.0.1:8188), polling for completion, and fetching the result.
// Plugs into the provider registry exactly like sdcpp, so ComfyUI checkpoints generate INSIDE the
// app's studios instead of requiring ComfyUI's own UI.
const crypto = require('crypto');

const DEFAULT_BASE = 'http://127.0.0.1:8188';

function resolveSeed(seed) {
  return seed != null && seed !== -1 ? seed : Math.floor(Math.random() * 2147483647);
}

// Map the studio's aspect_ratio + resolution to pixel dims (multiples of 8 for the latent).
function dims(params) {
  if (params.width && params.height) return [params.width, params.height];
  const base = params.resolution && params.resolution > 0 ? params.resolution : 1024;
  const ar = String(params.aspect_ratio || '1:1');
  const [a, b] = ar.split(':').map(Number);
  if (!a || !b || a === b) return [base, base];
  const long = Math.round((base * Math.max(a, b)) / Math.min(a, b) / 8) * 8;
  return a > b ? [long, base] : [base, long];
}

// Pure: build a standard ComfyUI txt2img prompt graph (checkpoint -> CLIP encode x2 -> latent ->
// KSampler -> VAE decode -> SaveImage). Node ids are strings, matching ComfyUI's API format.
function buildWorkflow({ prompt, negativePrompt = '', width = 1024, height = 1024, steps = 25, cfg = 7, seed = 0, ckptName, samplerName = 'euler', scheduler = 'normal' }) {
  return {
    '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: ckptName } },
    '6': { class_type: 'CLIPTextEncode', inputs: { text: prompt, clip: ['4', 1] } },
    '7': { class_type: 'CLIPTextEncode', inputs: { text: negativePrompt, clip: ['4', 1] } },
    '5': { class_type: 'EmptyLatentImage', inputs: { width, height, batch_size: 1 } },
    '3': { class_type: 'KSampler', inputs: { seed, steps, cfg, sampler_name: samplerName, scheduler, denoise: 1, model: ['4', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0] } },
    '8': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
    '9': { class_type: 'SaveImage', inputs: { filename_prefix: 'app', images: ['8', 0] } },
  };
}

// Pure: FLUX.2 GGUF txt2img graph — GGUF unet + single Mistral text encoder (CLIPLoader type 'flux2')
// + flux2 VAE. Used for the comfyui:flux2-klein recipe; classes verified against the running ComfyUI.
function buildFlux2Workflow({ prompt, negativePrompt = '', width = 1024, height = 1024, steps = 20, cfg = 1, seed = 0, unetName, clipName, vaeName, samplerName = 'euler', scheduler = 'simple' }) {
  return {
    '10': { class_type: 'UnetLoaderGGUF', inputs: { unet_name: unetName } },
    '11': { class_type: 'CLIPLoader', inputs: { clip_name: clipName, type: 'flux2' } },
    '12': { class_type: 'VAELoader', inputs: { vae_name: vaeName } },
    '6': { class_type: 'CLIPTextEncode', inputs: { text: prompt, clip: ['11', 0] } },
    '7': { class_type: 'CLIPTextEncode', inputs: { text: negativePrompt, clip: ['11', 0] } },
    '5': { class_type: 'EmptyLatentImage', inputs: { width, height, batch_size: 1 } },
    '3': { class_type: 'KSampler', inputs: { seed, steps, cfg, sampler_name: samplerName, scheduler, denoise: 1, model: ['10', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0] } },
    '8': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['12', 0] } },
    '9': { class_type: 'SaveImage', inputs: { filename_prefix: 'app', images: ['8', 0] } },
  };
}

// Pure: pull the first saved image descriptor out of a /history response for the given prompt id.
function findOutputImage(history, promptId) {
  const entry = history && history[promptId];
  const outputs = entry && entry.outputs;
  if (!outputs) return null;
  for (const node of Object.values(outputs)) {
    if (node && Array.isArray(node.images) && node.images.length) return node.images[0];
  }
  return null;
}

// Pure: build the /view URL that serves a generated image.
function viewUrl(baseUrl, img) {
  const q = new URLSearchParams({ filename: img.filename, subfolder: img.subfolder || '', type: img.type || 'output' });
  return `${baseUrl.replace(/\/$/, '')}/view?${q.toString()}`;
}

function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    if (signal) signal.addEventListener('abort', () => { clearTimeout(t); reject(new Error('Generation cancelled')); }, { once: true });
  });
}

// generate(): submit the workflow, poll until the image is ready, fetch it. Returns { buffer, ext, seed }.
async function generate({ model, params, baseUrl = DEFAULT_BASE }, onProgress = () => {}, { signal } = {}) {
  const [width, height] = dims(params);
  const seed = resolveSeed(params.seed);
  const recipe = model.recipe;

  let workflow;
  if (recipe && recipe.workflow === 'flux2') {
    // Multi-file FLUX.2: pull each component's filename from the recipe's dest folders.
    const fileName = (prefix) => {
      const f = (recipe.files || []).find((x) => x.dest.startsWith(prefix));
      return f ? f.dest.split('/').pop() : undefined;
    };
    workflow = buildFlux2Workflow({
      prompt: params.prompt || '', negativePrompt: params.negative_prompt || '',
      width, height, steps: params.steps || 20, cfg: params.guidance_scale || 1, seed,
      unetName: fileName('unet/'), clipName: fileName('text_encoders/'), vaeName: fileName('vae/'),
    });
  } else {
    const ckptName = model.ckptName || model.filename || model.id;
    if (!ckptName) throw new Error('ComfyUI model has no checkpoint name');
    workflow = buildWorkflow({
      prompt: params.prompt || '', negativePrompt: params.negative_prompt || '',
      width, height, steps: params.steps || 25, cfg: params.guidance_scale || 7,
      seed, ckptName, samplerName: model.sampler || 'euler', scheduler: model.scheduler || 'normal',
    });
  }

  const clientId = crypto.randomUUID();
  const submit = await fetch(`${baseUrl}/prompt`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: workflow, client_id: clientId }), signal,
  });
  if (!submit.ok) throw new Error(`ComfyUI rejected the workflow (${submit.status}): ${(await submit.text()).slice(0, 300)}`);
  const promptId = (await submit.json()).prompt_id;
  onProgress({ status: 'generating' });

  // Poll history until the image is ready, the prompt errors, or we're cancelled.
  for (;;) {
    if (signal && signal.aborted) throw new Error('Generation cancelled');
    await delay(800, signal);
    let history = {};
    try { history = await (await fetch(`${baseUrl}/history/${promptId}`, { signal })).json(); } catch {}
    const img = findOutputImage(history, promptId);
    if (img) {
      const res = await fetch(viewUrl(baseUrl, img), { signal });
      if (!res.ok) throw new Error(`ComfyUI image fetch failed (${res.status})`);
      const buffer = Buffer.from(await res.arrayBuffer());
      return { buffer, ext: (img.filename.split('.').pop() || 'png').toLowerCase(), seed };
    }
    const entry = history[promptId];
    if (entry && entry.status && entry.status.status_str === 'error') {
      throw new Error('ComfyUI workflow failed — check the ComfyUI console (missing model or node).');
    }
  }
}

module.exports = { buildWorkflow, buildFlux2Workflow, findOutputImage, viewUrl, dims, resolveSeed, generate };
