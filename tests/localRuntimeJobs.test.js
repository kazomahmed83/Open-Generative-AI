// tests/localRuntimeJobs.test.js
const test = require('node:test');
const assert = require('node:assert');
const jobs = require('../lib/local-runtime/jobs.js');

test('job lifecycle: create -> events -> complete', () => {
  const id = jobs.createJob('image', { model: 'z-image-turbo' });
  assert.ok(id);
  jobs.appendEvent(id, { step: 1, totalSteps: 8 });
  jobs.completeJob(id, { url: '/api/assets/x.png' });
  const job = jobs.getJob(id);
  assert.strictEqual(job.status, 'done');
  assert.strictEqual(job.events.length, 1);
  assert.strictEqual(job.result.url, '/api/assets/x.png');
});

test('subscribe receives progress then end', async () => {
  const id = jobs.createJob('image', {});
  const got = [];
  const done = new Promise((res) => jobs.subscribe(id, (e) => { got.push(e); if (e.type === 'end') res(); }));
  jobs.appendEvent(id, { step: 1, totalSteps: 2 });
  jobs.completeJob(id, { url: '/y.png' });
  await done;
  assert.ok(got.some(e => e.type === 'progress'));
  assert.ok(got.some(e => e.type === 'end'));
});
