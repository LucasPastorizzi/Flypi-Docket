import { useCallback, useEffect, useState } from 'react';
import {
  concederAcessoPortal, listarAcessosDoProcesso, listarLoginsDoPortal,
  revogarAcessoPortal, type AcessoPortal,
} from '../banco/dados';
import { useSessao } from '../banco/sessao';
import { formatarInstante, type Parte } from '../banco/tipos';
import { Botao, Campo, Entrada, Erro, Sucesso } from './Formulario';

// Concessão de acesso do cliente final ao processo.
//
// É o ato em que dado do escritório passa a sair dele, e a tela foi escrita
// com isso em mente: mostra quem já tem acesso, quando ganhou, e permite
// revogar — porque a concessão existe justamente para ser revogável sem mexer
// em dado processual.
//
// A lista de candidatos vem das PARTES deste processo que são clientes do
// escritório, e não da carteira inteira. O banco impõe o mesmo por trigger: só
// se concede acesso a quem figura como parte. As duas travas cobrem furos
// opostos — o trigger protege contra a mão errada na tela, e a concessão
// explícita protege contra um CPF digitado errado virar acesso sozinho.
export function AcessoDoPortal({ processoId, partes }: {
  processoId: string; partes: Parte[];
}) {
  const { usuario } = useSessao();
  const [acessos, setAcessos] = useState<AcessoPortal[]>([]);
  const [logins, setLogins] = useState<Record<string, number>>({});
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [escolhido, setEscolhido] = useState('');
  const [observacao, setObservacao] = useState('');

  const carregar = useCallback(async () => {
    const { dados, erro: falha } = await listarAcessosDoProcesso(processoId);
    if (falha) setErro(falha); else setAcessos(dados);
  }, [processoId]);

  useEffect(() => { void carregar(); }, [carregar]);

  // Candidatos: partes deste processo que são clientes do escritório.
  const candidatos = partes.filter((p) => p.cliente_id !== null);

  useEffect(() => {
    void (async () => {
      const contagem: Record<string, number> = {};
      for (const parte of candidatos) {
        if (!parte.cliente_id || contagem[parte.cliente_id] !== undefined) continue;
        const { dados } = await listarLoginsDoPortal(parte.cliente_id);
        contagem[parte.cliente_id] = dados.filter((l) => l.ativo).length;
      }
      setLogins(contagem);
    })();
    // A lista de partes é estável dentro da tela; recarregar a cada render
    // faria uma consulta por parte a cada digitação no formulário.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partes.length]);

  const vivos = acessos.filter((a) => a.revogado_em === null);
  const revogados = acessos.filter((a) => a.revogado_em !== null);

  const podeGerir = usuario?.admin_escritorio === true
                 || usuario?.papel === 'advogado_responsavel'
                 || usuario?.papel === 'secretaria';

  return (
    <section aria-labelledby="t-portal" className="mt-8">
      <h2 id="t-portal" className="text-lg font-semibold text-slate-900">
        Acesso do cliente ao portal
      </h2>
      <p className="mt-1 max-w-3xl text-sm text-slate-600">
        Liberar aqui faz este processo aparecer no portal do cliente. Ele não
        vê prazos, tarefas, partes nem anotações internas — só o andamento e os
        documentos que vocês marcarem como visíveis.
      </p>

      <Erro>{erro}</Erro>
      <Sucesso>{aviso}</Sucesso>

      {vivos.length === 0 ? (
        <p className="mt-3 rounded-md border border-slate-200 bg-white px-4
                      py-4 text-sm text-slate-700">
          Nenhum cliente acompanha este processo pelo portal.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-slate-100 rounded-lg border
                       border-slate-200 bg-white">
          {vivos.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-x-3
                                      gap-y-1 px-4 py-3">
              <span className="font-medium text-slate-900">
                {a.clientes?.nome ?? a.cliente_id}
              </span>
              <span className="text-sm text-slate-600">
                liberado em {formatarInstante(a.concedido_em)}
              </span>
              {/* Concessão sem login é concessão que não chega a ninguém: o
                  escritório acha que liberou e o cliente não recebe nada. */}
              {logins[a.cliente_id] === 0 && (
                <span className="rounded bg-amber-100 px-2 py-0.5 text-xs
                                 font-medium text-amber-900">
                  este cliente ainda não tem login de portal
                </span>
              )}
              {podeGerir && usuario && (
                <Botao variante="perigo" onClick={async () => {
                  const { erro: f } = await revogarAcessoPortal(a.id, usuario.id);
                  if (f) setErro(f);
                  else {
                    setAviso('Acesso revogado. O cliente deixa de ver este '
                           + 'processo na próxima consulta.');
                    await carregar();
                  }
                }}>
                  Revogar acesso
                </Botao>
              )}
            </li>
          ))}
        </ul>
      )}

      {podeGerir && usuario && candidatos.length > 0 && (
        <form
          className="mt-4 max-w-2xl space-y-4 rounded-lg border
                     border-slate-200 bg-white p-4"
          onSubmit={async (evento) => {
            evento.preventDefault();
            if (!escolhido) return;
            setErro(null);
            const { erro: f } = await concederAcessoPortal(
              usuario.escritorio_id, escolhido, processoId, usuario.id,
              observacao,
            );
            if (f) { setErro(f); return; }
            setAviso('Acesso liberado. O cliente já vê este processo no portal.');
            setEscolhido(''); setObservacao('');
            await carregar();
          }}
        >
          <Campo id="cliente-portal" rotulo="Liberar para"
                 ajuda="Só aparecem aqui as partes deste processo que são clientes do escritório.">
            <select id="cliente-portal" value={escolhido}
                    onChange={(e) => setEscolhido(e.target.value)}
                    aria-describedby="cliente-portal-ajuda"
                    className="mt-1 w-full rounded-md border border-slate-300
                               bg-white px-3 py-2">
              <option value="">Escolha…</option>
              {candidatos
                .filter((p) => !vivos.some((a) => a.cliente_id === p.cliente_id))
                .map((p) => (
                  <option key={p.id} value={p.cliente_id ?? ''}>
                    {p.nome} — {p.qualificacao}
                  </option>
                ))}
            </select>
          </Campo>

          <Campo id="obs-portal" rotulo="Observação"
                 ajuda="Por que o acesso está sendo liberado. Fica no registro.">
            <Entrada id="obs-portal" temAjuda value={observacao}
                     onChange={(e) => setObservacao(e.target.value)} />
          </Campo>

          <Botao type="submit">Liberar acesso ao portal</Botao>
        </form>
      )}

      {candidatos.length === 0 && podeGerir && (
        <p className="mt-3 rounded-md bg-amber-50 px-4 py-3 text-sm
                      text-amber-900">
          Nenhuma parte deste processo está vinculada a um cliente do
          escritório. Cadastre a parte e aponte-a para o cliente antes de
          liberar o portal — é essa ligação que o banco exige para aceitar a
          concessão.
        </p>
      )}

      {/* O histórico de revogações é a resposta para "quem podia ver este
          processo em março". Por isso revogar não apaga a linha. */}
      {revogados.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-sm font-medium text-slate-700">
            Acessos encerrados ({revogados.length})
          </summary>
          <ul className="mt-2 space-y-1 text-sm text-slate-600">
            {revogados.map((a) => (
              <li key={a.id}>
                {a.clientes?.nome ?? a.cliente_id} — de{' '}
                {formatarInstante(a.concedido_em)} até{' '}
                {formatarInstante(a.revogado_em)}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
