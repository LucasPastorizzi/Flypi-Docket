import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  concluirTarefa, listarMembrosDoEscritorio, listarTarefas, salvarTarefa,
} from '../banco/dados';
import { useSessao } from '../banco/sessao';
import {
  diasCorridosAte, formatarData, PAPEL_LEGIVEL, STATUS_TAREFA_LEGIVEL,
  type MembroDoEscritorio, type Tarefa,
} from '../banco/tipos';
import {
  AreaDeTexto, Botao, Campo, Carregando, Entrada, Erro, Selecao, Sucesso, Vazio,
} from '../componentes/Formulario';

export function Tarefas() {
  const { usuario } = useSessao();
  const [tarefas, setTarefas] = useState<Tarefa[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [mostrarConcluidas, setMostrarConcluidas] = useState(false);

  const carregar = useCallback(async () => {
    const { dados, erro: falha } = await listarTarefas();
    if (falha) setErro(falha); else setTarefas(dados);
    setCarregando(false);
  }, []);

  useEffect(() => { void carregar(); }, [carregar]);

  const visiveis = tarefas.filter((t) =>
    mostrarConcluidas || (t.status !== 'concluida' && t.status !== 'cancelada'));

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-slate-900">Tarefas</h1>
        <Botao><Link to="/tarefas/nova">Nova tarefa</Link></Botao>
      </div>
      <p className="mt-1 text-sm text-slate-600">
        As suas, e as dos processos em que você trabalha.
      </p>

      <Erro>{erro}</Erro>
      <Sucesso>{aviso}</Sucesso>
      {carregando && <Carregando />}

      <label className="mt-4 flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" checked={mostrarConcluidas}
               onChange={(e) => setMostrarConcluidas(e.target.checked)}
               className="size-4" />
        Mostrar concluídas e canceladas
      </label>

      {!carregando && visiveis.length === 0 && (
        <Vazio>Nenhuma tarefa em aberto.</Vazio>
      )}

      <ul className="mt-4 divide-y divide-slate-100 rounded-lg border
                     border-slate-200 bg-white">
        {visiveis.map((tarefa) => {
          const dias = diasCorridosAte(tarefa.data_limite);
          const atrasada = dias !== null && dias < 0
                        && tarefa.status !== 'concluida';
          return (
            <li key={tarefa.id} className="flex flex-wrap items-center gap-x-3
                                           gap-y-1 px-4 py-3">
              <span className={tarefa.status === 'concluida'
                ? 'text-slate-500 line-through' : 'font-medium text-slate-900'}>
                {tarefa.titulo}
              </span>
              {tarefa.data_limite && (
                <span className={atrasada
                  ? 'text-sm font-medium text-red-700' : 'text-sm text-slate-600'}>
                  {atrasada ? 'atrasada desde ' : 'até '}
                  {formatarData(tarefa.data_limite)}
                </span>
              )}
              <span className="text-sm text-slate-600">
                {STATUS_TAREFA_LEGIVEL[tarefa.status]}
              </span>
              {tarefa.processo_id && (
                <Link to={`/processos/${tarefa.processo_id}`}
                      className="text-sm text-sky-800 underline">
                  ver processo
                </Link>
              )}
              {tarefa.status !== 'concluida' && usuario && (
                <Botao variante="secundario" onClick={async () => {
                  const { erro: f } = await concluirTarefa(tarefa.id, usuario.id);
                  if (f) setErro(f);
                  else { setAviso('Tarefa concluída.'); await carregar(); }
                }}>
                  Concluir
                </Botao>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}

export function TarefaFormulario() {
  const { id: processoId } = useParams();
  const { usuario } = useSessao();
  const navegar = useNavigate();
  const [membros, setMembros] = useState<MembroDoEscritorio[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [form, setForm] = useState({
    titulo: '', descricao: '', responsavel_id: '', data_limite: '',
  });

  useEffect(() => {
    void listarMembrosDoEscritorio().then((r) => setMembros(r.dados));
  }, []);

  async function enviar(evento: React.FormEvent) {
    evento.preventDefault();
    if (!usuario) return;
    setSalvando(true);
    setErro(null);
    const { erro: falha } = await salvarTarefa({
      escritorio_id: usuario.escritorio_id,
      processo_id: processoId ?? null,
      titulo: form.titulo,
      descricao: form.descricao || null,
      responsavel_id: form.responsavel_id || usuario.id,
      atribuido_por: usuario.id,
      data_limite: form.data_limite || null,
    } as never);
    setSalvando(false);
    if (falha) { setErro(falha); return; }
    navegar(processoId ? `/processos/${processoId}` : '/tarefas');
  }

  return (
    <>
      <h1 className="text-xl font-semibold text-slate-900">Nova tarefa</h1>
      <Erro>{erro}</Erro>

      <form onSubmit={enviar} className="mt-6 max-w-2xl space-y-5">
        <Campo id="titulo" rotulo="O que precisa ser feito" obrigatorio>
          <Entrada id="titulo" required value={form.titulo}
                   onChange={(e) => setForm({ ...form,
                     titulo: e.target.value })} />
        </Campo>

        <Campo id="descricao" rotulo="Detalhes">
          <AreaDeTexto id="descricao" value={form.descricao}
                       onChange={(e) => setForm({ ...form,
                         descricao: e.target.value })} />
        </Campo>

        <div className="grid gap-5 sm:grid-cols-2">
          <Campo id="responsavel_id" rotulo="Responsável">
            <Selecao id="responsavel_id" value={form.responsavel_id}
                     onChange={(e) => setForm({ ...form,
                       responsavel_id: e.target.value })}>
              <option value="">Eu mesmo</option>
              {membros.filter((m) => m.ativo).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nome} — {PAPEL_LEGIVEL[m.papel]}
                </option>
              ))}
            </Selecao>
          </Campo>

          <Campo id="data_limite" rotulo="Prazo interno"
                 ajuda="Costuma ser antes do vencimento processual — é a antecedência que faz a tarefa servir.">
            <Entrada id="data_limite" type="date" temAjuda
                     value={form.data_limite}
                     onChange={(e) => setForm({ ...form,
                       data_limite: e.target.value })} />
          </Campo>
        </div>

        <div className="flex gap-3">
          <Botao type="submit" disabled={salvando}>
            {salvando ? 'Salvando…' : 'Criar tarefa'}
          </Botao>
          <Botao variante="secundario" onClick={() => navegar(-1)}>
            Cancelar
          </Botao>
        </div>
      </form>
    </>
  );
}
