import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ProvedorDeSessao } from './banco/sessao';
import { App } from './App';
import { PortalRaiz } from './portal/Portal';
import './index.css';

const raiz = document.getElementById('raiz');
if (!raiz) throw new Error('elemento #raiz não encontrado em index.html');

// A escolha entre a área da equipe e o portal do cliente é feita aqui, pelo
// caminho da URL, e não por uma rota dentro da mesma aplicação.
//
// O motivo é conter o alcance: cada lado tem o seu provedor de sessão, o seu
// layout e as suas consultas, e nenhum componente da área interna é carregado
// no portal. O cliente não vê a navegação do escritório e não aprende que
// existem telas de equipe, prazos internos e auditoria.
//
// Isso é organização, não proteção: o que impede o cliente de ler dado interno
// é o RLS — app.escritorio_atual() devolve NULL para ele, e as policies
// internas negam por construção, mesmo que ele digite a URL da equipe.
const ehPortal = window.location.pathname.startsWith('/portal');

createRoot(raiz).render(
  <StrictMode>
    <BrowserRouter>
      {ehPortal ? (
        <PortalRaiz />
      ) : (
        <ProvedorDeSessao>
          <App />
        </ProvedorDeSessao>
      )}
    </BrowserRouter>
  </StrictMode>
);
