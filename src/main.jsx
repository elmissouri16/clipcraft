import './i18n/boot.js'; // the UI language, before anything else evaluates (docs/design/localization.md)
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from "./app/App.jsx";
import ErrorBoundary from "./components/ui/ErrorBoundary.jsx";
import FrameInspection from "./features/preview/FrameInspection.jsx";
import '@fontsource-variable/inter';
import "./styles/styles.css";
import { installRangeFill } from './app/rangeFill.js';

// Platform marker for native layout details (e.g. the macOS window buttons in the top bar).
document.documentElement.dataset.platform = window.api?.platform || 'web';
installRangeFill();
// The shell's boundary: an error in the app component itself. Try again mounts it afresh (Home,
// where the project's autosave slot can be reopened) instead of leaving a blank window.
createRoot(document.getElementById('root')).render(window.frameInspection ? <FrameInspection /> : <ErrorBoundary name="the app shell"><App /></ErrorBoundary>);
