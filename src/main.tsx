import React from 'react';
import ReactDOM from 'react-dom/client';
import { Providers } from './providers';
import App from './App';
import '@fontsource-variable/cascadia-code';
import './assets/fonts/selawik.css';
import './index.css';
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Providers>
      <App />
    </Providers>
  </React.StrictMode>,
);
