import { useEffect, useState } from 'react';
import { supabase } from '../banco/cliente';
import {
  listarDocumentosDoPortal, listarProcessosDoPortal,
} from '../banco/dados';
import {
  formatarCnj, formatarData, SITUACAO_LEGIVEL, type ProcessoDetalhado,
} from '../banco/tipos';
import { Botao, Campo, Carregando, Entrada, Erro, Vazio } from '../componentes/Formulario';
import { ProvedorDoPortal, usePortal } from './sessaoPortal';

// Portal do cliente final.
//
// Área separada, com login próprio e layout próprio, e isso é decisão de
// segurança e não de estética: o cliente não deve ver a navegação do
// escritório nem aprender que existem telas de equipe, prazos internos e
// auditoria. O que ele não conhece, não tenta abrir.
//
// O que o protege não é esta separação, e sim o RLS: mesmo montando a URL
// interna à mão, `app.escritorio_atual()` devolve NULL para ele e as policies
// internas negam por construção. A separação evita a confusão; a policy evita
// o vazamento.

export function PortalRaiz() {
  return (
    <ProvedorDoPortal>
      <PortalConteudo />
    </ProvedorDoPortal>
  );
}

function PortalConteudo() {
  const { sessao, cliente, carregando, naoEhCliente, sair } = usePortal();

  if (carregando) {
    return <p className="p-8 text-slate-600" aria-live="polite">Carregando…</p>;
  }
  if (!sessao) return <LoginDoPortal />;

  if (naoEhCliente || !cliente) {
    return (
      <main className="min-h-dvh grid place-items-center px-4">
        <div className="max-w-md text-center">
          <h1 className="text-xl font-semibold text-slate-900">
            Esta área é do cliente
          </h1>
          <p className="mt-2 text-slate-700">
            Sua conta está autenticada, mas não é um acesso de cliente. Se você
            é do escritório, entre pela área da equipe.
          </p>
          <div className="mt-6 flex justify-center gap-3">
            <Botao variante="secundario" onClick={() => void sair()}>Sair</Botao>
            <Botao><a href="/">Ir para a área da equipe</a></Botao>
          </div>
        </div>
      </main>
    );
  }

  return <MeusProcessos nome={cliente.nome} aoSair={sair} />;
}

function LoginDoPortal() {
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function entrar(evento: React.FormEvent) {
    evento.preventDefault();
    setErro(null);
    setEnviando(true);
    const { error } = await supabase.auth.signInWithPassword({
      email, password: senha,
    });
    setEnviando(false);
    // Mensagem genérica: distinguir "e-mail não existe" de "senha errada"
    // entregaria a terceiros quem é cliente de qual escritório — e isso já é
    // informação num produto que guarda processo sob sigilo.
    if (error) setErro('E-mail ou senha incorretos.');
  }

  return (
    <main className="min-h-dvh grid place-items-center bg-slate-50 px-4">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold text-slate-900">
          Acompanhe seu processo
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Acesso para clientes do escritório.
        </p>

        <form onSubmit={entrar} className="mt-8 space-y-4">
          <Campo id="email-portal" rotulo="E-mail" obrigatorio>
            <Entrada id="email-portal" type="email" required
                     autoComplete="username" value={email}
                     onChange={(e) => setEmail(e.target.value)} />
          </Campo>
          <Campo id="senha-portal" rotulo="Senha" obrigatorio>
            <Entrada id="senha-portal" type="password" required
                     autoComplete="current-password" value={senha}
                     onChange={(e) => setSenha(e.target.value)} />
          </Campo>
          <Erro>{erro}</Erro>
          <Botao type="submit" disabled={enviando}
                 className="w-full rounded-md bg-sky-700 px-3 py-2 font-medium
                            text-white hover:bg-sky-800 disabled:opacity-60">
            {enviando ? 'Entrando…' : 'Entrar'}
          </Botao>
        </form>
      </div>
    </main>
  );
}

function MeusProcessos({ nome, aoSair }: {
  nome: string; aoSair: () => Promise<void>;
}) {
  const [processos, setProcessos] = useState<ProcessoDetalhado[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [aberto, setAberto] = useState<string | null>(null);

  useEffect(() => {
    void listarProcessosDoPortal().then(({ dados, erro: falha }) => {
      if (falha) setErro(falha); else setProcessos(dados);
      setCarregando(false);
    });
  }, []);

  return (
    <div className="min-h-dvh bg-slate-50">
      <a href="#conteudo"
         className="sr-only focus:not-sr-only focus:absolute focus:left-4
                    focus:top-4 focus:z-50 focus:rounded-md focus:bg-white
                    focus:px-4 focus:py-2 focus:font-medium focus:text-sky-900">
        Pular para o conteúdo
      </a>

      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center gap-4 px-4 py-3">
          <span className="font-semibold text-slate-900">Meus processos</span>
          <div className="ml-auto flex items-center gap-3">
            <span className="text-sm text-slate-700">{nome}</span>
            <Botao variante="secundario" onClick={() => void aoSair()}>
              Sair
            </Botao>
          </div>
        </div>
      </header>

      <main id="conteudo" tabIndex={-1} className="mx-auto max-w-4xl px-4 py-8">
        <Erro>{erro}</Erro>
        {carregando && <Carregando />}

        {!carregando && processos.length === 0 && (
          <Vazio>
            Nenhum processo liberado para acompanhamento no momento. Se você
            espera ver um caso aqui, fale com o escritório — a liberação é
            feita por eles, caso a caso.
          </Vazio>
        )}

        <ul className="space-y-4">
          {processos.map((p) => (
            <li key={p.id} className="rounded-lg border border-slate-200
                                      bg-white p-4">
              <h2 className="font-semibold text-slate-900">
                {formatarCnj(p.numero_cnj)}
              </h2>
              <p className="text-sm text-slate-600">
                {p.classe ?? 'Processo'}
                {p.tribunal && ` · ${p.tribunal}`}
                {p.comarca && ` · ${p.comarca}`}
              </p>

              <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                <div>
                  <dt className="text-xs uppercase tracking-wide text-slate-500">
                    Situação
                  </dt>
                  <dd className="text-sm text-slate-900">
                    {SITUACAO_LEGIVEL[p.situacao]}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-slate-500">
                    Distribuído em
                  </dt>
                  <dd className="text-sm text-slate-900">
                    {formatarData(p.data_distribuicao)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-slate-500">
                    Assunto
                  </dt>
                  <dd className="text-sm text-slate-900">{p.assunto ?? '—'}</dd>
                </div>
              </dl>

              <div className="mt-3">
                <Botao variante="secundario"
                       onClick={() => setAberto(aberto === p.id ? null : p.id)}
                       aria-expanded={aberto === p.id}
                       aria-controls={`docs-${p.id}`}>
                  {aberto === p.id ? 'Ocultar documentos' : 'Ver documentos'}
                </Botao>
              </div>

              {aberto === p.id && (
                <DocumentosDoProcesso id={p.id} />
              )}
            </li>
          ))}
        </ul>

        {/* O que o portal deliberadamente não mostra, dito na tela.
            Um cliente que não encontra o andamento detalhado precisa saber que
            é assim por desenho, e não que o sistema está incompleto ou que o
            escritório escondeu algo dele. */}
        {processos.length > 0 && (
          <p className="mt-8 rounded-md bg-slate-100 px-4 py-3 text-sm
                        text-slate-700">
            Você vê aqui os processos que o escritório liberou para
            acompanhamento, e os documentos que eles marcaram como seus. Prazos
            internos, estratégia e anotações do escritório não aparecem —
            converse com quem cuida do seu caso para falar sobre eles.
          </p>
        )}
      </main>
    </div>
  );
}

function DocumentosDoProcesso({ id }: { id: string }) {
  const [docs, setDocs] = useState<Array<{
    id: string; nome_original: string; criado_em: string;
  }>>([]);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    void listarDocumentosDoPortal(id).then(({ dados }) => {
      setDocs(dados); setCarregando(false);
    });
  }, [id]);

  if (carregando) return <Carregando />;

  return (
    <div id={`docs-${id}`} className="mt-3 rounded-md border border-slate-200
                                      bg-slate-50 p-3">
      {docs.length === 0 ? (
        <p className="text-sm text-slate-700">
          Nenhum documento disponível para você neste processo. O escritório
          libera documento a documento.
        </p>
      ) : (
        <ul className="space-y-1 text-sm">
          {docs.map((d) => (
            <li key={d.id} className="text-slate-800">
              {d.nome_original}
              <span className="ml-2 text-slate-600">
                {formatarData(d.criado_em.slice(0, 10))}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
