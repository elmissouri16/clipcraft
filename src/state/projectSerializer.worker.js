// pretty: false for the chat, which is only ever written compact.
self.onmessage = ({ data: { id, project, pretty = true } }) => {
  try {
    self.postMessage({ id, value: { compact: JSON.stringify(project), ...(pretty ? { pretty: JSON.stringify(project, null, 2) } : {}) } });
  } catch (error) { self.postMessage({ id, error: error.message }); }
};
