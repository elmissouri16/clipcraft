// Keep project JSON parsing and atomic disk writes away from Electron's IPC
// thread. A single worker preserves invocation order for each project and slot.
const { Worker, isMainThread, parentPort } = require('node:worker_threads');

if (!isMainThread) {
  const fs = require('node:fs');
  const slots = require('./autosave.cjs');
  parentPort.on('message', ({ id, kind, args }) => {
    try {
      let value;
      if (kind === 'project') {
        const [file, json] = args;
        fs.writeFileSync(`${file}.part`, json, 'utf8');fs.renameSync(`${file}.part`, file);value = true;
      } else if (kind === 'slot') value = slots.writeSlot(...args);
      else throw new Error('Unknown persistence operation.');
      parentPort.postMessage({ id, value });
    } catch (error) { parentPort.postMessage({ id, error: error.message }); }
  });
} else {
  class ProjectPersistence {
    constructor() { this.worker = null;this.pending = new Map();this.next = 0; }
    request(kind, args) {
      if (!this.worker) {
        const worker = this.worker = new Worker(__filename);
        const failed = error => {
          if (this.worker !== worker) return;
          this.worker = null;
          for (const request of this.pending.values()) request.reject(error);
          this.pending.clear();
        };
        worker.on('error', failed);
        worker.on('exit', code => { if (code !== 0) failed(new Error(`Project writer stopped (${code}).`)); });
        worker.on('message', data => {
          const request = this.pending.get(data.id);if (!request) return;
          this.pending.delete(data.id);
          if (data.error) request.reject(new Error(data.error));else request.resolve(data.value);
          if (!this.pending.size) worker.unref();
        });
      }
      return new Promise((resolve, reject) => {
        const id = ++this.next;this.pending.set(id, { resolve, reject });this.worker.ref();
        try { this.worker.postMessage({ id, kind, args }); }
        catch (error) { this.pending.delete(id);if (!this.pending.size) this.worker.unref();reject(error); }
      });
    }
    writeProject(file, json) { return this.request('project', [file, json]); }
    writeSlot(root, record) { return this.request('slot', [root, record]); }
    async close() {
      const worker = this.worker;this.worker = null;
      for (const request of this.pending.values()) request.reject(new Error('Project writer closed.'));
      this.pending.clear();if (worker) await worker.terminate();
    }
  }
  module.exports = { ProjectPersistence };
}
