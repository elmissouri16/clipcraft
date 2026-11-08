self.onmessage = ({ data: { id, project } }) => {
  try {
    self.postMessage({ id, value: { compact: JSON.stringify(project), pretty: JSON.stringify(project, null, 2) } });
  } catch (error) { self.postMessage({ id, error: error.message }); }
};
