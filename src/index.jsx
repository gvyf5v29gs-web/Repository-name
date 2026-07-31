import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

// 注册 Service Worker（PWA 离线缓存）
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('./sw.js')
      .catch((err) => console.error('[SW] 注册失败:', err));
  });
}

const container = document.getElementById('root');
const root = createRoot(container);
root.render(<App />);
