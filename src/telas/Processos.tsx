import { useEffect, useState } from 'react';
import { supabase } from '../banco/cliente';
import { useSessao } from '../banco/sessao';
import { formatarDinheiro, type Processo } from '../banco/tipos';

const SITUACAO_LEGIVEL: Record<string, string> = {
  ativo: 'Ativo', suspenso: 'Suspenso', arquivado: 'Arquivado',
  baixado: 'Baixado', encerrado: 'Encerrado',
};

// Esta tela é, de quebra, a prova visual do RLS: o responsável e a secretaria
// veem os processos do escritório, o associado vê só aqueles em que foi
// incluído na equipe, e nenhum dos dois vê nada do escritório vizinho. A
// consulta abaixo é a MESMA para todos — não há filtro por papel aqui, e não
// deve haver. Quem recorta é a policy.
export function Processos() {
  const { usuario } = useSessao();
  const [processos, setProcessos] = useState<Processo[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let ativo = true;
    void (async () => {
      const { data, error } = await supabase
        .from('processos')
        .select(`id, numero_cnj, numero_pasta, tribunal, comarca, situacao,
                 segredo_justica, valor_causa, advogado_responsavel_id`)
        .order('criado_em', { ascending: false });
      if (!ativo) return;
      if (error) setErro(error.message);
      else setProcessos((data ?? []) as Processo[]);
      setCarregando(false);
    })();
    return () => { ativo = false; };
  }, []);

  function formatarCnj(numero: string | null): string {
    if (!numero || numero.length !== 20) return numero ?? '—';
    // NNNNNNN-DD.AAAA.J.TR.OOOO — a máscara é apresentação; o banco guarda
    // só os vinte dígitos, para casar com o que a API do CNJ devolve.
    return `${numero.slice(0, 7)}-${numero.slice(7, 9)}.${numero.slice(9, 13)}`
         + `.${numero.slice(13, 14)}.${numero.slice(14, 16)}.${numero.slice(16)}`;
  }

  return (
    <>
      <h1 className="text-xl font-semibold text-slate-900">Processos</h1>
      <p className="mt-1 text-sm text-slate-600">
        {usuario?.papel === 'advogado_associado'
          || usuario?.papel === 'estagiario'
          ? 'Os processos em que você foi incluído na equipe.'
          : 'Os processos do escritório.'}
      </p>

      {erro && (
        <p role="alert" className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm
                                   font-medium text-red-800">
          {erro}
        </p>
      )}

      {carregando && <p className="mt-6 text-slate-600">Carregando…</p>}

      {!carregando && processos.length === 0 && (
        <p className="mt-6 rounded-md border border-slate-200 bg-white px-4
                      py-6 text-slate-700">
          Nenhum processo à vista. Processo em segredo de justiça não aparece
          nesta lista: a leitura dele passa por um caminho próprio, que
          registra quem acessou.
        </p>
      )}

      {processos.length > 0 && (
        <div className="mt-6 overflow-x-auto rounded-lg border
                        border-slate-200 bg-white">
          {/* caption e th com scope: é o que permite ao leitor de tela
              anunciar "Número, linha 3" em vez de despejar células soltas.
              Tabela sem isso é ilegível sem enxergar. */}
          <table className="w-full text-left text-sm">
            <caption className="sr-only">
              Processos visíveis para você, com número, tribunal, situação e
              valor da causa
            </caption>
            <thead className="border-b border-slate-200 bg-slate-50">
              <tr>
                <th scope="col" className="px-4 py-3 font-semibold">Número</th>
                <th scope="col" className="px-4 py-3 font-semibold">Tribunal</th>
                <th scope="col" className="px-4 py-3 font-semibold">Comarca</th>
                <th scope="col" className="px-4 py-3 font-semibold">Situação</th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  Valor da causa
                </th>
              </tr>
            </thead>
            <tbody>
              {processos.map((p) => (
                <tr key={p.id} className="border-b border-slate-100
                                          last:border-0">
                  <th scope="row" className="px-4 py-3 font-medium
                                             text-slate-900">
                    {formatarCnj(p.numero_cnj)}
                    {p.numero_pasta && (
                      <span className="block font-normal text-slate-600">
                        pasta {p.numero_pasta}
                      </span>
                    )}
                  </th>
                  <td className="px-4 py-3 text-slate-700">
                    {p.tribunal ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-700">
                    {p.comarca ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-700">
                    {SITUACAO_LEGIVEL[p.situacao] ?? p.situacao}
                  </td>
                  <td className="px-4 py-3 text-slate-700">
                    {formatarDinheiro(p.valor_causa)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
