import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { listarAuditoria, listarMembrosDoEscritorio } from '../banco/dados';
import {
  formatarInstante, type LinhaAuditoria, type MembroDoEscritorio,
} from '../banco/tipos';
import { Carregando, Erro, Vazio } from '../componentes/Formulario';

const ACAO_LEGIVEL: Record<string, string> = {
  leitura: 'Leitura', criacao: 'Criação', alteracao: 'Alteração',
  exclusao_logica: 'Exclusão', concessao_portal: 'Acesso concedido ao portal',
  revogacao_portal: 'Acesso revogado', exportacao: 'Exportação',
};

const ATOR_LEGIVEL: Record<string, string> = {
  equipe: 'Equipe', portal: 'Cliente (portal)', servico: 'Rotina do sistema',
};

export function Auditoria() {
  const [linhas, setLinhas] = useState<LinhaAuditoria[]>([]);
  const [membros, setMembros] = useState<MembroDoEscritorio[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([listarAuditoria(), listarMembrosDoEscritorio()])
      .then(([a, m]) => {
        if (a.erro) setErro(a.erro); else setLinhas(a.dados);
        setMembros(m.dados);
        setCarregando(false);
      });
  }, []);

  const nomeDe = (id: string | null) =>
    membros.find((m) => m.id === id)?.nome ?? (id ? 'conta externa' : 'sistema');

  return (
    <>
      <h1 className="text-xl font-semibold text-slate-900">
        Trilha de auditoria
      </h1>
      <p className="mt-1 max-w-3xl text-sm text-slate-600">
        Quem acessou o quê. Cada abertura de processo em segredo de justiça
        gera uma linha aqui — inclusive as tentativas negadas, que são
        justamente as que interessam numa investigação. A trilha não pode ser
        alterada nem apagada por ninguém, nem por quem administra.
      </p>

      <Erro>{erro}</Erro>
      {carregando && <Carregando />}
      {!carregando && linhas.length === 0 && (
        <Vazio>
          Nenhum registro ainda — ou o seu papel não dá acesso à trilha. Ela
          expõe o comportamento de cada pessoa da equipe, então fica com quem
          responde pelo escritório.
        </Vazio>
      )}

      {linhas.length > 0 && (
        <div className="mt-6 overflow-x-auto rounded-lg border border-slate-200
                        bg-white">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">
              Últimos 200 registros de acesso e alteração
            </caption>
            <thead className="border-b border-slate-200 bg-slate-50">
              <tr>
                <th scope="col" className="px-4 py-3 font-semibold">Quando</th>
                <th scope="col" className="px-4 py-3 font-semibold">Quem</th>
                <th scope="col" className="px-4 py-3 font-semibold">O quê</th>
                <th scope="col" className="px-4 py-3 font-semibold">Resultado</th>
                <th scope="col" className="px-4 py-3 font-semibold">Origem</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((l) => {
                const negado = l.dados_depois?.resultado === 'negado';
                return (
                  <tr key={l.id} className={[
                    'border-b border-slate-100 last:border-0',
                    negado ? 'bg-red-50' : '',
                  ].join(' ')}>
                    <th scope="row" className="whitespace-nowrap px-4 py-3
                                               font-medium">
                      {formatarInstante(l.ocorrido_em)}
                    </th>
                    <td className="px-4 py-3 text-slate-700">
                      {nomeDe(l.ator_id)}
                      <span className="block text-xs text-slate-500">
                        {ATOR_LEGIVEL[l.ator_tipo] ?? l.ator_tipo}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {ACAO_LEGIVEL[l.acao] ?? l.acao} · {l.entidade}
                      {l.processo_id && (
                        <Link to={`/processos/${l.processo_id}`}
                              className="ml-2 text-sky-800 underline">
                          ver processo
                        </Link>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {negado ? (
                        <span className="font-medium text-red-800">
                          Negado
                        </span>
                      ) : (
                        <span className="text-slate-700">
                          Permitido
                          {l.dados_depois?.sigiloso && ' · sob sigilo'}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {l.ip ?? '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="h-10" />
    </>
  );
}
