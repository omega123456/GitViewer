import React from 'react';
import ReactDOM from 'react-dom/client';
import { Providers } from './providers';
import App from './App';
import '@fontsource-variable/cascadia-code';
import './assets/fonts/selawik.css';
import './index.css';
const root = document.getElementById('root');
if (root)
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <Providers>
        <App />
      </Providers>
    </React.StrictMode>,
  );
