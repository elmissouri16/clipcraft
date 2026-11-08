const abortError = () => Object.assign(new Error('Stopped.'), { name: 'AbortError' });
const checkAbort = signal => { if (signal?.aborted) throw abortError(); };
function abortable(promise, signal) {
  checkAbort(signal);
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    const abort = () => { cleanup(); reject(abortError()); };
    const cleanup = () => signal.removeEventListener('abort', abort);
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(promise).then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
    if (signal.aborted) abort();
  });
}
const scopedFetch = (fetchImpl, signal) => (url, options = {}) => {
  checkAbort(signal);
  return fetchImpl(url, { ...options, signal: options.signal ? AbortSignal.any([options.signal, signal]) : signal });
};
// Long edits may legitimately remain active for longer than one timeout window.
// Reset on activity; explicit cancellation remains independent of this timer.
function activityTimeout(onTimeout, timeoutMs, clock = { setTimeout, clearTimeout }) {
  let timer, disposed = false;
  const touch = () => {
    if (disposed) return;
    clock.clearTimeout(timer);
    timer = clock.setTimeout(() => { disposed = true; onTimeout(); }, timeoutMs);
  };
  touch();
  return { touch, dispose() { disposed = true; clock.clearTimeout(timer); } };
}
module.exports = { abortError, checkAbort, abortable, scopedFetch, activityTimeout };
