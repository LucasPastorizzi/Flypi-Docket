import { useCallback, useEffect, useState } from 'react';
import { atualizarMembro, listarMembrosDoEscritorio } from '../banco/dados';
import { useSessao } from '../banco/sessao';
import { PAPEL_LEGIVEL, type MembroDoEscritorio, type PapelUsuario } from '../banco/tipos';
import {
  Botao, Carregando, Erro, Selecao, Sucesso, Vazio,
} from '../componentes/Formulario';

export function Equipe() {
  const { usuario } = useSessao();
  const [membros, setMembros] = useState<MembroDoEscritorio[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    const { dados, erro: falha } = await listarMembrosDoEscritorio();
    if (falha) setErro(falha); else setMembros(dados);
    setCarregando(false);
  }, []);

  useEffect(() => { void carregar(); }, [carregar]);

  const souAdmin = usuario?.admin_escritorio === true;

  async function mudar(id: string, mudanca: Partial<MembroDoEscritorio>) {
    setErro(null);
    const { erro: falha } = await atualizarMembro(id, mudanca);
    // O banco recusa escalada por trigger, então um erro aqui costuma ser
    // exatamente isso: a mensagem dele é mais útil que qualquer texto nosso.
    if (falha) setErro(falha);
    else { setAviso('Alteração salva.'); await carregar(); }
  }

  return (
    <>
      <h1 className="text-xl font-semibold text-slate-900">Equipe</h1>
      <p className="mt-1 max-w-3xl text-sm text-slate-600">
        O papel define o que a pessoa enxerga. Advogado responsável e
        secretaria veem o escritório todo; associado e estagiário veem apenas
        os processos em que foram incluídos — isso se faz na tela do processo.
      </p>

      <Erro>{erro}</Erro>
      <Sucesso>{aviso}</Sucesso>
      {carregando && <Carregando />}
      {!carregando && membros.length === 0 && (
        <Vazio>Nenhum membro visível.</Vazio>
      )}

      {membros.length > 0 && (
        <div className="mt-6 overflow-x-auto rounded-lg border border-slate-200
                        bg-white">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">
              Pessoas do escritório, com papel e situação
            </caption>
            <thead className="border-b border-slate-200 bg-slate-50">
              <tr>
                <th scope="col" className="px-4 py-3 font-semibold">Nome</th>
                <th scope="col" className="px-4 py-3 font-semibold">E-mail</th>
                <th scope="col" className="px-4 py-3 font-semibold">Papel</th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  Administra
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">Acesso</th>
              </tr>
            </thead>
            <tbody>
              {membros.map((m) => (
                <tr key={m.id} className="border-b border-slate-100 last:border-0">
                  <th scope="row" className="px-4 py-3 font-medium">
                    {m.nome}
                    {m.id === usuario?.id && (
                      <span className="ml-2 rounded bg-slate-100 px-2 py-0.5
                                       text-xs font-normal text-slate-700">
                        você
                      </span>
                    )}
                  </th>
                  <td className="px-4 py-3 text-slate-700">{m.email}</td>
                  <td className="px-4 py-3">
                    {souAdmin ? (
                      <>
                        <label htmlFor={`papel-${m.id}`} className="sr-only">
                          Papel de {m.nome}
                        </label>
                        <Selecao id={`papel-${m.id}`} value={m.papel}
                                 onChange={(e) => void mudar(m.id, {
                                   papel: e.target.value as PapelUsuario })}>
                          {Object.entries(PAPEL_LEGIVEL).map(([v, r]) => (
                            <option key={v} value={v}>{r}</option>
                          ))}
                        </Selecao>
                      </>
                    ) : PAPEL_LEGIVEL[m.papel]}
                  </td>
                  <td className="px-4 py-3">
                    {souAdmin ? (
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox" checked={m.admin_escritorio}
                          className="size-4"
                          onChange={(e) => void mudar(m.id, {
                            admin_escritorio: e.target.checked })}
                        />
                        <span className="sr-only">
                          {m.nome} administra o escritório
                        </span>
                      </label>
                    ) : (m.admin_escritorio ? 'Sim' : 'Não')}
                  </td>
                  <td className="px-4 py-3">
                    {souAdmin && m.id !== usuario?.id ? (
                      <Botao
                        variante={m.ativo ? 'perigo' : 'secundario'}
                        onClick={() => void mudar(m.id, { ativo: !m.ativo })}
                      >
                        {m.ativo ? 'Desativar' : 'Reativar'}
                      </Botao>
                    ) : (
                      <span className={m.ativo ? 'text-green-800'
                                               : 'text-red-800'}>
                        {m.ativo ? 'Ativo' : 'Desativado'}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {souAdmin && (
        <div className="mt-6 max-w-3xl rounded-lg border border-slate-200
                        bg-slate-50 p-4 text-sm text-slate-700">
          <h2 className="font-semibold text-slate-900">Para incluir alguém</h2>
          <p className="mt-1">
            A conta precisa existir na autenticação antes de virar membro do
            escritório. Enquanto a tela de convite não existe, quem administra
            cria a conta no painel do Supabase e o vínculo é feito pela equipe
            de desenvolvimento.
          </p>
          <p className="mt-2">
            Desativar aqui tira o acesso na <strong>consulta seguinte</strong>,
            sem esperar o token expirar — foi por isso que o escritório da
            pessoa é resolvido no banco a cada consulta, e não guardado dentro
            do token.
          </p>
        </div>
      )}
      <div className="h-10" />
    </>
  );
}
