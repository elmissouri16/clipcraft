// Editorial workflow (plan approval, transcript cuts, beats, critique, Undo) in the real app.
process.env.FVE_SMOKE_MODE = 'agent-editorial';
require('./test-agent-capabilities-ui.cjs');
