import { Navigate, Route, Routes } from 'react-router-dom';
import { useSessao } from './banco/sessao';
import { Layout } from './componentes/Layout';
import { Botao } from './componentes/Formulario';
import { Login } from './telas/Login';
import { FilaDePrazos } from './telas/FilaDePrazos';
import { Processos } from './telas/Processos';
import { ProcessoDetalhe } from './telas/ProcessoDetalhe';
import { ProcessoFormulario } from './telas/ProcessoFormulario';
import { ParteFormulario } from './telas/ParteFormulario';
import { PrazoFormulario } from './telas/PrazoFormulario';
import { Clientes } from './telas/Clientes';
import { ClienteFormulario } from './telas/ClienteFormulario';
import { Tarefas, TarefaFormulario } from './telas/Tarefas';
import { Feriados } from './telas/Feriados';
import { Equipe } from './telas/Equipe';
import { Auditoria } from './telas/Auditoria';

export function App() {
  const { sessao, usuario, carregando, semVinculo, sair } = useSessao();

  if (carregando) {
    return <p className="p-8 text-slate-600" aria-live="polite">Carregando…</p>;
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
          <div className="mt-6">
            <Botao variante="secundario" onClick={() => void sair()}>
              Sair
            </Botao>
          </div>
        </div>
      </main>
    );
  }

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/prazos" element={<FilaDePrazos />} />

        <Route path="/processos" element={<Processos />} />
        <Route path="/processos/novo" element={<ProcessoFormulario />} />
        <Route path="/processos/:id" element={<ProcessoDetalhe />} />
        <Route path="/processos/:id/editar" element={<ProcessoFormulario />} />
        <Route path="/processos/:id/partes/nova" element={<ParteFormulario />} />
        <Route path="/processos/:id/prazos/novo" element={<PrazoFormulario />} />
        <Route path="/processos/:id/tarefas/nova" element={<TarefaFormulario />} />

        <Route path="/clientes" element={<Clientes />} />
        <Route path="/clientes/novo" element={<ClienteFormulario />} />
        <Route path="/clientes/:id/editar" element={<ClienteFormulario />} />

        <Route path="/tarefas" element={<Tarefas />} />
        <Route path="/tarefas/nova" element={<TarefaFormulario />} />

        <Route path="/calendario" element={<Feriados />} />
        <Route path="/equipe" element={<Equipe />} />
        <Route path="/auditoria" element={<Auditoria />} />

        {/* A fila de confirmação é a primeira tela de propósito: é o que tem
            consequência se ficar sem olhar. */}
        <Route path="*" element={<Navigate to="/prazos" replace />} />
      </Route>
    </Routes>
  );
}
