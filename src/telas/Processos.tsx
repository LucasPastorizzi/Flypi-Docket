import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { listarProcessos } from '../banco/dados';
import { useSessao } from '../banco/sessao';
import {
  formatarCnj, formatarDinheiro, SITUACAO_LEGIVEL, type Processo,
} from '../banco/tipos';
import { Botao, Carregando, Erro, Vazio } from '../componentes/Formulario';

// Esta tela é, de quebra, a prova visual do RLS: o responsável e a secretaria
// veem os processos do escritório, o associado vê só aqueles em que foi
// incluído na equipe, e nenhum dos dois vê nada do escritório vizinho. A
// consulta é a MESMA para todos — não há filtro por papel aqui, e não deve
// haver. Quem recorta é a policy.
export function Processos() {
  const { usuario } = useSessao();
  const [processos, setProcessos] = useState<Processo[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState('');

  useEffect(() => {
    void listarProcessos().then(({ dados, erro: falha }) => {
      if (falha) setErro(falha); else setProcessos(dados);
      setCarregando(false);
    });
  }, []);

  const filtrados = processos.filter((p) => {
    const alvo = busca.replace(/\D/g, '');
    return busca === ''
      || (p.numero_cnj ?? '').includes(alvo)
      || (p.numero_pasta ?? '').toLowerCase().includes(busca.toLowerCase())
      || (p.comarca ?? '').toLowerCase().includes(busca.toLowerCase());
  });

  const recorteDoPapel = usuario?.papel === 'advogado_associado'
                      || usuario?.papel === 'estagiario';

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-slate-900">Processos</h1>
        <Botao><Link to="/processos/novo">Novo processo</Link></Botao>
      </div>
      <p className="mt-1 text-sm text-slate-600">
        {recorteDoPapel
          ? 'Os processos em que você foi incluído na equipe.'
          : 'Os processos do escritório.'}
      </p>

      <Erro>{erro}</Erro>
      {carregando && <Carregando />}

      {!carregando && processos.length === 0 && (
        <Vazio>
          Nenhum processo à vista. Processo em segredo de justiça não aparece
          nesta lista, para ninguém: a leitura dele passa por um caminho
          próprio, que registra quem acessou.
        </Vazio>
      )}

      {processos.length > 0 && (
        <>
          <div className="mt-6 max-w-sm">
            <label htmlFor="busca-processo"
                   className="block text-sm font-medium text-slate-700">
              Buscar por número, pasta ou comarca
            </label>
            <input id="busca-processo" type="search" value={busca}
                   onChange={(e) => setBusca(e.target.value)}
                   className="mt-1 w-full rounded-md border border-slate-300
                              px-3 py-2" />
          </div>
          <p aria-live="polite" className="sr-only">
            {filtrados.length} processos encontrados
          </p>

          <div className="mt-4 overflow-x-auto rounded-lg border
                          border-slate-200 bg-white">
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
                {filtrados.map((p) => (
                  <tr key={p.id} className="border-b border-slate-100
                                            last:border-0">
                    <th scope="row" className="px-4 py-3 font-medium">
                      <Link to={`/processos/${p.id}`}
                            className="text-sky-800 underline">
                        {formatarCnj(p.numero_cnj)}
                      </Link>
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
                      {SITUACAO_LEGIVEL[p.situacao]}
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {formatarDinheiro(p.valor_causa)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
