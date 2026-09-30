import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ProvedorDeSessao } from './banco/sessao';
import { App } from './App';
import './index.css';

const raiz = document.getElementById('raiz');
if (!raiz) throw new Error('elemento #raiz não encontrado em index.html');

createRoot(raiz).render(
  <StrictMode>
    <BrowserRouter>
      <ProvedorDeSessao>
        <App />
      </ProvedorDeSessao>
    </BrowserRouter>
  </StrictMode>
);
