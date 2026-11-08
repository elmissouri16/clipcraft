// Reuse the isolated Vite/Electron lifecycle with a focused regression scenario.
process.env.FVE_SMOKE_MODE = 'agent-ownership';
require('./test-agent-capabilities-ui.cjs');
