import React from 'react';
import { createRoot } from 'react-dom/client';
import App from "./app/App.jsx";
import FrameInspection from "./features/preview/FrameInspection.jsx";
import '@fontsource-variable/inter';
import "./styles/styles.css";
import { installRangeFill } from './app/rangeFill.js';

// Platform marker for native layout details (e.g. the macOS window buttons in the top bar).
document.documentElement.dataset.platform = window.api?.platform || 'web';
installRangeFill();
createRoot(document.getElementById('root')).render(window.frameInspection ? <FrameInspection /> : <App />);
