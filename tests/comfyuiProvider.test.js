// tests/comfyuiProvider.test.js
const test = require('node:test');
const assert = require('node:assert');
const { buildWorkflow, buildFlux2Workflow, findOutputImage, viewUrl } = require('../lib/local-runtime/providers/comfyui.js');

test('buildFlux2Workflow: GGUF unet + mistral clip + flux2 vae graph', () => {
  const wf = buildFlux2Workflow({
    prompt: 'a fox', width: 1024, height: 1024, steps: 20, seed: 7,
    unetName: 'flux-2-klein-base-9b-Q4_K_M.gguf',
    clipName: 'mistral_3_small_flux2_fp8.safetensors',
    vaeName: 'flux2-vae.safetensors',
  });
  const types = Object.values(wf).map((n) => n.class_type);
  assert.ok(types.includes('UnetLoaderGGUF'), 'uses GGUF unet loader');
  assert.ok(types.includes('CLIPLoader'), 'uses CLIPLoader for mistral');
  assert.ok(types.includes('VAELoader'), 'loads flux2 vae');
  assert.ok(types.includes('EmptySD3LatentImage'), 'uses 16-channel SD3 latent (not 4-ch EmptyLatentImage)');
  assert.ok(types.includes('FluxGuidance'), 'routes positive conditioning through FluxGuidance');
  assert.ok(types.includes('VAEDecode') && types.includes('SaveImage'), 'decodes + saves');
  assert.ok(JSON.stringify(wf).includes('flux-2-klein-base-9b-Q4_K_M.gguf'), 'gguf unet wired');
  // KSampler must run at cfg 1 (FLUX guidance lives in the conditioning)
  const ksampler = Object.values(wf).find((n) => n.class_type === 'KSampler');
  assert.strictEqual(ksampler.inputs.cfg, 1);
});

test('buildWorkflow produces a valid txt2img graph with prompt/size/seed wired', () => {
  const g = buildWorkflow({
    prompt: 'a red cat', negativePrompt: 'blurry', width: 1024, height: 768,
    steps: 25, cfg: 7, seed: 42, ckptName: 'sd_xl_base_1.0.safetensors',
    samplerName: 'euler', scheduler: 'normal',
  });
  // Checkpoint loader carries the chosen model
  const ckpt = Object.values(g).find((n) => n.class_type === 'CheckpointLoaderSimple');
  assert.strictEqual(ckpt.inputs.ckpt_name, 'sd_xl_base_1.0.safetensors');
  // Positive prompt is encoded
  const encoders = Object.values(g).filter((n) => n.class_type === 'CLIPTextEncode');
  assert.ok(encoders.some((n) => n.inputs.text === 'a red cat'));
  assert.ok(encoders.some((n) => n.inputs.text === 'blurry'));
  // Latent carries the size
  const latent = Object.values(g).find((n) => n.class_type === 'EmptyLatentImage');
  assert.strictEqual(latent.inputs.width, 1024);
  assert.strictEqual(latent.inputs.height, 768);
  // Sampler carries seed/steps/cfg
  const ks = Object.values(g).find((n) => n.class_type === 'KSampler');
  assert.strictEqual(ks.inputs.seed, 42);
  assert.strictEqual(ks.inputs.steps, 25);
  assert.strictEqual(ks.inputs.cfg, 7);
  // Graph terminates in a SaveImage
  assert.ok(Object.values(g).some((n) => n.class_type === 'SaveImage'));
});

test('buildWorkflow node references are internally consistent (KSampler -> loader/encoders/latent)', () => {
  const g = buildWorkflow({ prompt: 'x', width: 512, height: 512, seed: 1, ckptName: 'm.safetensors' });
  const entry = Object.entries(g);
  const idOf = (ct) => entry.find(([, n]) => n.class_type === ct)[0];
  const ks = Object.values(g).find((n) => n.class_type === 'KSampler');
  assert.strictEqual(ks.inputs.model[0], idOf('CheckpointLoaderSimple'));
  assert.strictEqual(ks.inputs.latent_image[0], idOf('EmptyLatentImage'));
  // positive/negative point at the two CLIPTextEncode nodes
  const encIds = entry.filter(([, n]) => n.class_type === 'CLIPTextEncode').map(([id]) => id);
  assert.ok(encIds.includes(ks.inputs.positive[0]));
  assert.ok(encIds.includes(ks.inputs.negative[0]));
});

test('findOutputImage extracts the saved image from /history outputs', () => {
  const history = {
    'pid-123': {
      outputs: {
        '9': { images: [{ filename: 'ComfyUI_00001_.png', subfolder: '', type: 'output' }] },
      },
    },
  };
  const img = findOutputImage(history, 'pid-123');
  assert.deepStrictEqual(img, { filename: 'ComfyUI_00001_.png', subfolder: '', type: 'output' });
});

test('findOutputImage returns null when the prompt is not done / no images', () => {
  assert.strictEqual(findOutputImage({}, 'pid-x'), null);
  assert.strictEqual(findOutputImage({ 'pid-x': { outputs: {} } }, 'pid-x'), null);
});

test('viewUrl builds the /view query for the output image', () => {
  const u = viewUrl('http://127.0.0.1:8188', { filename: 'a b.png', subfolder: 'sub', type: 'output' });
  assert.match(u, /^http:\/\/127\.0\.0\.1:8188\/view\?/);
  assert.match(u, /filename=a(\+|%20)b\.png/);
  assert.match(u, /subfolder=sub/);
  assert.match(u, /type=output/);
});
