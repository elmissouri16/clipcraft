// Floating recording bar: shows the time sent by the editor, sends Pause and Stop back, folds into a small tab.
const pad = (v) => String(Math.floor(v)).padStart(2, '0');
document.getElementById('stop').addEventListener('click', () => window.recbar.stop());
document.getElementById('pause').addEventListener('click', () => window.recbar.pause());
document.getElementById('hide').addEventListener('click', () => window.recbar.collapse(true));
document.getElementById('tab').addEventListener('click', () => window.recbar.collapse(false));
window.recbar.onCollapsed((on) => document.body.classList.toggle('collapsed', on));
window.recbar.onState((s) => {
  document.getElementById('time').textContent = `${pad(s.seconds / 60)}:${pad(s.seconds % 60)}`;
  document.body.classList.toggle('paused', !!s.paused);
  document.getElementById('pause').textContent = s.paused ? 'Resume' : 'Pause';
});
