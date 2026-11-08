// Native message boxes instead of the page's alert()/confirm(). The first line
// is the headline, the rest the detail text. When the host offers no native box
// (UI test runs stub the page functions), the page functions are used.
const native = req => { try { const r = window.api?.messageBoxSync?.(req); return r && !r.unavailable ? r : null; } catch { return null; } };
export function showAlert(message) {
  if (!native({ kind: 'alert', message: String(message) })) window.alert(message);
}
export function askConfirm(message, confirmLabel = 'OK') {
  const r = native({ kind: 'confirm', message: String(message), confirmLabel });
  return r ? !!r.confirmed : window.confirm(message);
}
