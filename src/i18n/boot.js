// Imported first by main.jsx so the language is settled before any component module evaluates: module-level
// tables may then call t() directly. The main process resolved the preference (settings + OS locale).
import { setLanguage } from './index.js';
setLanguage(window.api?.language || 'system');
