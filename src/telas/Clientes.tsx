import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { listarClientes } from '../banco/dados';
import { formatarDocumento, type Cliente } from '../banco/tipos';
import { Botao, Carregando, Erro, Vazio } from '../componentes/Formulario';

export function Clientes() {
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState('');

  useEffect(() => {
    void listarClientes().then(({ dados, erro: falha }) => {
      if (falha) setErro(falha); else setClientes(dados);
      setCarregando(false);
    });
  }, []);

  // Busca no cliente e não no servidor: a carteira de um escritório de 1 a 10
  // advogados cabe em memória com folga, e ida ao servidor a cada tecla
  // custaria mais do que resolve. Quando passar de alguns milhares, vira
  // filtro no PostgREST.
  const filtrados = clientes.filter((c) =>
    c.nome.toLowerCase().includes(busca.toLowerCase())
    || (c.documento ?? '').includes(busca.replace(/\D/g, '')));

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-slate-900">Clientes</h1>
        <Botao>
          <Link to="/clientes/novo">Novo cliente</Link>
        </Botao>
      </div>

      <Erro>{erro}</Erro>
      {carregando && <Carregando />}

      {!carregando && clientes.length === 0 && (
        <Vazio>
          Nenhum cliente cadastrado ainda — ou o seu papel no escritório não dá
          acesso à carteira de clientes. Associado e estagiário chegam ao
          cliente pelo processo em que trabalham.
        </Vazio>
      )}

      {clientes.length > 0 && (
        <>
          <div className="mt-6 max-w-sm">
            <label htmlFor="busca" className="block text-sm font-medium
                                              text-slate-700">
              Buscar por nome ou documento
            </label>
            <input
              id="busca" type="search" value={busca}
              onChange={(e) => setBusca(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3
                         py-2"
            />
          </div>

          {/* O resultado da busca é anunciado, senão quem não vê a tela digita
              e não sabe se filtrou algo. */}
          <p aria-live="polite" className="sr-only">
            {filtrados.length} clientes encontrados
          </p>

          <div className="mt-4 overflow-x-auto rounded-lg border
                          border-slate-200 bg-white">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">
                Clientes do escritório, com documento, contato e município
              </caption>
              <thead className="border-b border-slate-200 bg-slate-50">
                <tr>
                  <th scope="col" className="px-4 py-3 font-semibold">Nome</th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Documento
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Contato
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Município
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtrados.map((c) => (
                  <tr key={c.id} className="border-b border-slate-100
                                            last:border-0">
                    <th scope="row" className="px-4 py-3 font-medium">
                      <Link to={`/clientes/${c.id}/editar`}
                            className="text-sky-800 underline">
                        {c.nome}
                      </Link>
                      {c.nome_social && (
                        <span className="block font-normal text-slate-600">
                          {c.nome_social}
                        </span>
                      )}
                    </th>
                    <td className="px-4 py-3 text-slate-700">
                      {formatarDocumento(c.documento)}
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {c.email ?? c.telefone ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {c.municipio ?? '—'}{c.uf && `/${c.uf}`}
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
