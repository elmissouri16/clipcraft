import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import FrameInspection from './FrameInspection.jsx';
import '@fontsource-variable/inter';
import './styles.css';

createRoot(document.getElementById('root')).render(window.frameInspection ? <FrameInspection /> : <App />);
