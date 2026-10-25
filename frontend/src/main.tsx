import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

// Prevent unhandled promise rejections or uncaught errors from bubbling to Electron
window.addEventListener('unhandledrejection', (event) => {
  console.warn('[Global Unhandled Rejection Caught]:', event.reason);
  event.preventDefault();
});

window.addEventListener('error', (event) => {
  console.warn('[Global Error Caught]:', event.error);
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

