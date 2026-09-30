import { Navigate, Route, Routes } from 'react-router-dom';
import { useSessao } from './banco/sessao';
import { Layout } from './componentes/Layout';
import { Login } from './telas/Login';
import { FilaDePrazos } from './telas/FilaDePrazos';
import { Processos } from './telas/Processos';

export function App() {
  const { sessao, usuario, carregando, semVinculo, sair } = useSessao();

  if (carregando) {
    return (
      <p className="p-8 text-slate-600" aria-live="polite">Carregando…</p>
    );
  }

  if (!sessao) return <Login />;

  // Autenticado e sem linha em `usuarios`. Acontece com conta de portal
  // tentando a área interna, com usuário desativado, e com conta criada no
  // Auth antes de o admin cadastrar o vínculo. Dizer isso é melhor que mostrar
  // telas vazias — lista vazia sugere que não há dado, e o problema é outro.
  if (semVinculo || !usuario) {
    return (
      <main className="min-h-dvh grid place-items-center px-4">
        <div className="max-w-md text-center">
          <h1 className="text-xl font-semibold text-slate-900">
            Conta sem vínculo com escritório
          </h1>
          <p className="mt-2 text-slate-700">
            Sua conta foi autenticada, mas não está vinculada a nenhum
            escritório — ou o acesso foi desativado. Peça a quem administra o
            escritório para verificar o cadastro.
          </p>
          <button
            type="button" onClick={() => void sair()}
            className="mt-6 rounded-md border border-slate-300 px-3 py-2
                       text-sm font-medium text-slate-700"
          >
            Sair
          </button>
        </div>
      </main>
    );
  }

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/prazos" element={<FilaDePrazos />} />
        <Route path="/processos" element={<Processos />} />
        {/* A fila de confirmação é a primeira tela de propósito: é o que tem
            consequência se ficar sem olhar. */}
        <Route path="*" element={<Navigate to="/prazos" replace />} />
      </Route>
    </Routes>
  );
}
