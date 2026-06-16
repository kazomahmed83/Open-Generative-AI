// lib/local-runtime/jobs.js
const { EventEmitter } = require('events');

const jobs = new Map();     // id -> { id, kind, payload, status, events, result, error }
const emitters = new Map(); // id -> EventEmitter

let counter = 0;
function nextId() { return `job_${Date.now()}_${++counter}`; }

function createJob(kind, payload) {
  const id = nextId();
  jobs.set(id, { id, kind, payload, status: 'running', events: [], result: null, error: null });
  emitters.set(id, new EventEmitter());
  return id;
}
function appendEvent(id, evt) {
  const job = jobs.get(id); if (!job) return;
  job.events.push(evt);
  emitters.get(id)?.emit('event', { type: 'progress', ...evt });
}
function completeJob(id, result) {
  const job = jobs.get(id); if (!job) return;
  job.status = 'done'; job.result = result;
  emitters.get(id)?.emit('event', { type: 'result', result });
  emitters.get(id)?.emit('event', { type: 'end' });
}
function failJob(id, error) {
  const job = jobs.get(id); if (!job) return;
  job.status = 'error'; job.error = String(error?.message || error);
  emitters.get(id)?.emit('event', { type: 'error', error: job.error });
  emitters.get(id)?.emit('event', { type: 'end' });
}
function getJob(id) { return jobs.get(id) || null; }
function subscribe(id, cb) {
  const em = emitters.get(id);
  if (!em) { cb({ type: 'end' }); return () => {}; }
  em.on('event', cb);
  return () => em.off('event', cb);
}

module.exports = { createJob, appendEvent, completeJob, failJob, getJob, subscribe };
