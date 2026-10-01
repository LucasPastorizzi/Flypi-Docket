import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  concluirTarefa, incluirNaEquipe, listarEquipe, listarMembrosDoEscritorio,
  listarPartes, listarPrazosDoProcesso, listarTarefas, obterProcesso,
  removerDaEquipe, verProcessoComRegistro,
} from '../banco/dados';
import { podeConfirmarPrazo, useSessao } from '../banco/sessao';
import {
  formatarCnj, formatarData, formatarDinheiro, formatarDocumento,
  PAPEL_LEGIVEL, POLO_LEGIVEL, SITUACAO_LEGIVEL, STATUS_TAREFA_LEGIVEL,
  type MembroDoEscritorio, type MembroEquipe, type Parte, type PrazoDaFila,
  type ProcessoDetalhado, type Tarefa,
} from '../banco/tipos';
import { Botao, Carregando, Erro, Sucesso, Vazio } from '../componentes/Formulario';
import { AcessoDoPortal } from '../componentes/AcessoDoPortal';
import { Documentos } from '../componentes/Documentos';

export function ProcessoDetalhe() {
  const { id = '' } = useParams();
  const { usuario } = useSessao();
  const [processo, setProcesso] = useState<ProcessoDetalhado | null>(null);
  const [partes, setPartes] = useState<Parte[]>([]);
  const [prazos, setPrazos] = useState<PrazoDaFila[]>([]);
  const [tarefas, setTarefas] = useState<Tarefa[]>([]);
  const [equipe, setEquipe] = useState<MembroEquipe[]>([]);
  const [membros, setMembros] = useState<MembroDoEscritorio[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [acessoRegistrado, setAcessoRegistrado] = useState(false);
  const [naoEncontrado, setNaoEncontrado] = useState(false);

  // As consultas das seções tinham os erros descartados, e a tela mostrava
  // "ninguém trabalha neste processo" quando na verdade a consulta havia
  // falhado. Falha silenciosa é pior que erro visível: manda procurar o
  // problema no dado, que está certo.
  const carregarSecoes = useCallback(async () => {
    const [p, z, t, e] = await Promise.all([
      listarPartes(id), listarPrazosDoProcesso(id), listarTarefas(id),
      listarEquipe(id),
    ]);
    const primeiraFalha = [p.erro, z.erro, t.erro, e.erro].find(Boolean);
    if (primeiraFalha) setErro(primeiraFalha);
    setPartes(p.dados); setPrazos(z.dados); setTarefas(t.dados);
    setEquipe(e.dados);
  }, [id]);

  const carregar = useCallback(async () => {
    setCarregando(true);
    const { dados, erro: falha } = await obterProcesso(id);
    if (falha) setErro(falha);

    // Conjunto vazio aqui não significa "não existe": pode ser processo em
    // segredo de justiça, que as policies excluem do SELECT direto. A tela
    // oferece o caminho auditado em vez de dizer que não achou — dizer "não
    // existe" para algo que existe é confundir o usuário para proteger um
    // dado que a RPC vai entregar de qualquer jeito, com registro.
    if (!dados) {
      setNaoEncontrado(true);
      setCarregando(false);
      return;
    }

    setProcesso(dados);
    await carregarSecoes();
    setCarregando(false);
  }, [id, carregarSecoes]);

  useEffect(() => { void carregar(); }, [carregar]);

  useEffect(() => {
    if (usuario?.papel === 'advogado_responsavel' || usuario?.admin_escritorio) {
      void listarMembrosDoEscritorio().then((r) => setMembros(r.dados));
    }
  }, [usuario]);

  async function abrirComRegistro() {
    setErro(null);
    const { dados, erro: falha } = await verProcessoComRegistro(id);
    if (falha) { setErro(falha); return; }
    if (!dados) {
      setErro(
        'Você não tem acesso a este processo. A tentativa foi registrada na '
        + 'trilha de auditoria do escritório responsável por ele.'
      );
      return;
    }
    setProcesso(dados);
    setNaoEncontrado(false);
    setAcessoRegistrado(true);
    await carregarSecoes();
  }

  if (carregando) return <Carregando />;

  if (naoEncontrado) {
    return (
      <>
        <h1 className="text-xl font-semibold text-slate-900">Processo</h1>
        <div className="mt-6 rounded-lg border-2 border-amber-400 bg-amber-50 p-5">
          <h2 className="font-semibold text-amber-900">
            Este processo não é legível por consulta comum
          </h2>
          <p className="mt-2 max-w-2xl text-sm text-amber-900">
            Ou ele está em segredo de justiça, ou você não tem acesso a ele.
            Nos dois casos o caminho é o mesmo: a leitura passa por uma função
            que <strong>registra quem acessou, quando e de qual endereço</strong>,
            antes de devolver o conteúdo. Não há como abrir sem deixar rastro —
            é assim de propósito.
          </p>
          <div className="mt-4">
            <Botao onClick={() => void abrirComRegistro()}>
              Abrir e registrar meu acesso
            </Botao>
          </div>
        </div>
        <Erro>{erro}</Erro>
      </>
    );
  }

  if (!processo) return <Vazio>Processo não encontrado.</Vazio>;

  const podeGerir = usuario?.papel === 'advogado_responsavel'
                 || usuario?.admin_escritorio === true;

  return (
    <>
      <p className="text-sm">
        <Link to="/processos" className="text-sky-800 underline">
          ← Processos
        </Link>
      </p>

      <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">
            {formatarCnj(processo.numero_cnj)}
          </h1>
          <p className="text-sm text-slate-600">
            {processo.numero_pasta && `pasta ${processo.numero_pasta} · `}
            {processo.tribunal} {processo.comarca && `· ${processo.comarca}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {processo.segredo_justica && (
            <span className="rounded-md bg-amber-100 px-2 py-1 text-xs
                             font-semibold text-amber-900">
              Segredo de justiça
            </span>
          )}
          <span className="rounded-md bg-slate-100 px-2 py-1 text-xs
                           font-medium text-slate-700">
            {SITUACAO_LEGIVEL[processo.situacao]}
          </span>
          <Botao variante="secundario">
            <Link to={`/processos/${id}/editar`}>Editar</Link>
          </Botao>
        </div>
      </div>

      {acessoRegistrado && (
        <Sucesso>
          Acesso registrado na trilha de auditoria: quem, quando e de onde.
        </Sucesso>
      )}
      <Erro>{erro}</Erro>
      <Sucesso>{aviso}</Sucesso>

      <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-3 rounded-lg border
                     border-slate-200 bg-white p-4 sm:grid-cols-4">
        {[
          ['Classe', processo.classe ?? '—'],
          ['Assunto', processo.assunto ?? '—'],
          ['Órgão julgador', processo.orgao_julgador ?? '—'],
          ['Distribuição', formatarData(processo.data_distribuicao)],
          ['Valor da causa', formatarDinheiro(processo.valor_causa)],
        ].map(([rotulo, valor]) => (
          <div key={rotulo}>
            <dt className="text-xs uppercase tracking-wide text-slate-500">
              {rotulo}
            </dt>
            <dd className="text-sm text-slate-900">{valor}</dd>
          </div>
        ))}
      </dl>

      {/* --- partes --- */}
      <section aria-labelledby="t-partes" className="mt-8">
        <div className="flex items-center justify-between">
          <h2 id="t-partes" className="text-lg font-semibold text-slate-900">
            Partes
          </h2>
          <Botao variante="secundario">
            <Link to={`/processos/${id}/partes/nova`}>Adicionar parte</Link>
          </Botao>
        </div>
        {partes.length === 0 ? (
          <Vazio>Nenhuma parte cadastrada.</Vazio>
        ) : (
          <ul className="mt-3 divide-y divide-slate-100 rounded-lg border
                         border-slate-200 bg-white">
            {partes.map((parte) => (
              <li key={parte.id} className="flex flex-wrap items-baseline
                                            gap-x-3 px-4 py-3">
                <span className="font-medium text-slate-900">{parte.nome}</span>
                <span className="text-sm text-slate-600">
                  {POLO_LEGIVEL[parte.polo]} · {parte.qualificacao}
                </span>
                <span className="text-sm text-slate-600">
                  {formatarDocumento(parte.documento)}
                </span>
                {/* A distinção que a tabela guarda e a tela precisa mostrar:
                    parte adversa também é parte, e não é cliente de ninguém. */}
                {parte.cliente_id ? (
                  <span className="rounded bg-sky-100 px-2 py-0.5 text-xs
                                   font-medium text-sky-900">
                    cliente do escritório
                  </span>
                ) : (
                  <span className="rounded bg-slate-100 px-2 py-0.5 text-xs
                                   text-slate-700">
                    parte adversa
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* --- prazos --- */}
      <section aria-labelledby="t-prazos" className="mt-8">
        <div className="flex items-center justify-between">
          <h2 id="t-prazos" className="text-lg font-semibold text-slate-900">
            Prazos
          </h2>
          {podeConfirmarPrazo(usuario) && (
            <Botao variante="secundario">
              <Link to={`/processos/${id}/prazos/novo`}>Lançar prazo</Link>
            </Botao>
          )}
        </div>
        {prazos.length === 0 ? (
          <Vazio>Nenhum prazo neste processo.</Vazio>
        ) : (
          <ul className="mt-3 divide-y divide-slate-100 rounded-lg border
                         border-slate-200 bg-white">
            {prazos.map((prazo) => {
              const compromisso = prazo.status !== 'sugerido'
                               && prazo.status !== 'cancelado';
              return (
                <li key={prazo.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-baseline gap-x-3">
                    <span className="font-medium text-slate-900">
                      {formatarData(
                        prazo.data_vencimento_confirmada
                        ?? prazo.data_vencimento_sugerida)}
                    </span>
                    <span className={[
                      'rounded px-2 py-0.5 text-xs font-medium',
                      compromisso ? 'bg-green-100 text-green-900'
                                  : 'bg-amber-100 text-amber-900',
                    ].join(' ')}>
                      {compromisso ? prazo.status : 'aguardando confirmação'}
                    </span>
                    <span className="text-sm text-slate-600">
                      {prazo.dias} {prazo.contagem === 'dias_uteis'
                        ? 'dias úteis' : 'dias corridos'}
                      {prazo.em_dobro && ' · em dobro'}
                    </span>
                  </div>
                  {/* Quando o advogado corrigiu a data, a sugestão original
                      fica visível ao lado. É essa divergência que revela regra
                      de prazo errada, e escondê-la apagaria o sinal. */}
                  {prazo.status === 'ajustado'
                   && prazo.data_vencimento_sugerida && (
                    <p className="mt-1 text-sm text-slate-600">
                      o sistema havia sugerido{' '}
                      {formatarData(prazo.data_vencimento_sugerida)} — ajustado
                      na conferência
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* --- tarefas --- */}
      <section aria-labelledby="t-tarefas" className="mt-8">
        <div className="flex items-center justify-between">
          <h2 id="t-tarefas" className="text-lg font-semibold text-slate-900">
            Tarefas
          </h2>
          <Botao variante="secundario">
            <Link to={`/processos/${id}/tarefas/nova`}>Nova tarefa</Link>
          </Botao>
        </div>
        {tarefas.length === 0 ? (
          <Vazio>Nenhuma tarefa neste processo.</Vazio>
        ) : (
          <ul className="mt-3 divide-y divide-slate-100 rounded-lg border
                         border-slate-200 bg-white">
            {tarefas.map((tarefa) => (
              <li key={tarefa.id} className="flex flex-wrap items-center
                                             gap-x-3 px-4 py-3">
                <span className={tarefa.status === 'concluida'
                  ? 'text-slate-500 line-through' : 'text-slate-900'}>
                  {tarefa.titulo}
                </span>
                <span className="text-sm text-slate-600">
                  {STATUS_TAREFA_LEGIVEL[tarefa.status]}
                  {tarefa.data_limite
                    && ` · até ${formatarData(tarefa.data_limite)}`}
                </span>
                {tarefa.status !== 'concluida' && usuario && (
                  <Botao
                    variante="secundario"
                    onClick={async () => {
                      const { erro: f } = await concluirTarefa(
                        tarefa.id, usuario.id);
                      if (f) setErro(f);
                      else { setAviso('Tarefa concluída.'); await carregar(); }
                    }}
                  >
                    Concluir
                  </Botao>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <Documentos processoId={id} />

      <AcessoDoPortal processoId={id} partes={partes} />

      {/* --- equipe --- */}
      <section aria-labelledby="t-equipe" className="mt-8 mb-10">
        <h2 id="t-equipe" className="text-lg font-semibold text-slate-900">
          Quem trabalha neste processo
        </h2>
        <p className="mt-1 max-w-2xl text-sm text-slate-600">
          Associado e estagiário só enxergam os processos em que foram
          incluídos aqui. Incluir alguém é dar acesso ao caso; retirar tira o
          acesso na consulta seguinte, e a saída fica registrada.
        </p>
        <ul className="mt-3 divide-y divide-slate-100 rounded-lg border
                       border-slate-200 bg-white">
          {equipe.length === 0 && (
            <li className="px-4 py-3 text-slate-700">
              Ninguém além de quem enxerga o escritório todo.
            </li>
          )}
          {equipe.map((membro) => (
            <li key={membro.id} className="flex flex-wrap items-center gap-x-3
                                           px-4 py-3">
              <span className="font-medium text-slate-900">
                {membro.usuarios?.nome ?? membro.usuario_id}
              </span>
              <span className="text-sm text-slate-600">
                {membro.usuarios && PAPEL_LEGIVEL[membro.usuarios.papel]}
              </span>
              {podeGerir && usuario && (
                <Botao
                  variante="perigo"
                  onClick={async () => {
                    const { erro: f } = await removerDaEquipe(
                      membro.id, usuario.id);
                    if (f) setErro(f);
                    else { setAviso('Acesso retirado.'); await carregar(); }
                  }}
                >
                  Retirar do caso
                </Botao>
              )}
            </li>
          ))}
        </ul>

        {podeGerir && usuario && membros.length > 0 && (
          <form
            className="mt-3 flex flex-wrap items-end gap-3"
            onSubmit={async (e) => {
              e.preventDefault();
              const dados = new FormData(e.currentTarget);
              const escolhido = String(dados.get('usuario') ?? '');
              if (!escolhido) return;
              const { erro: f } = await incluirNaEquipe(
                usuario.escritorio_id, id, escolhido, usuario.id);
              if (f) setErro(f);
              else { setAviso('Acesso concedido ao caso.'); await carregar(); }
            }}
          >
            <div>
              <label htmlFor="incluir" className="block text-sm font-medium
                                                  text-slate-700">
                Incluir alguém no caso
              </label>
              <select id="incluir" name="usuario"
                      className="mt-1 rounded-md border border-slate-300
                                 bg-white px-3 py-2">
                <option value="">Escolha…</option>
                {membros
                  .filter((m) => m.ativo
                    && !equipe.some((e2) => e2.usuario_id === m.id))
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.nome} — {PAPEL_LEGIVEL[m.papel]}
                    </option>
                  ))}
              </select>
            </div>
            <Botao type="submit">Incluir</Botao>
          </form>
        )}
      </section>
    </>
  );
}
