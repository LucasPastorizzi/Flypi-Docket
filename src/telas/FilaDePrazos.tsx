import { useCallback, useEffect, useState } from 'react';
import { confirmarPrazo, listarPrazosSugeridos } from '../banco/dados';
import { podeConfirmarPrazo, useSessao } from '../banco/sessao';
import { diasCorridosAte, formatarData, type PrazoDaFila } from '../banco/tipos';

// A tela que é o produto.
//
// O requisito inegociável do briefing: o sistema SUGERE e exige confirmação
// humana antes de o prazo virar compromisso. A interface tem que deixar isso
// óbvio, e não apenas cumprir tecnicamente — se a sugestão parecer um
// compromisso já lançado, o advogado vai tratá-la como tal, e a confirmação
// passa a ser um clique de despache em vez de uma conferência.
//
// Daí três decisões de tela: a sugestão nunca é chamada de "prazo do
// escritório", a data aparece junto da conta que a produziu (dias, contagem,
// fundamento), e confirmar e ajustar são dois caminhos igualmente visíveis —
// não um botão principal e um link escondido.

export function FilaDePrazos() {
  const { usuario } = useSessao();
  const [prazos, setPrazos] = useState<PrazoDaFila[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ajustando, setAjustando] = useState<string | null>(null);
  const [dataAjustada, setDataAjustada] = useState('');
  const [salvando, setSalvando] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    const { dados, erro: falha } = await listarPrazosSugeridos();
    if (falha) setErro(falha);
    else setPrazos(dados);
    setCarregando(false);
  }, []);

  useEffect(() => { void carregar(); }, [carregar]);

  async function confirmar(prazo: PrazoDaFila, dataFinal: string) {
    if (!usuario) return;
    setSalvando(prazo.id);
    setErro(null);

    // 'confirmado' quando a data sugerida foi aceita como está; 'ajustado'
    // quando o advogado corrigiu. A distinção não é cosmética: é ela que
    // permite medir depois com que frequência o cálculo erra, e em que tipo de
    // ato. A sugestão original fica intacta no banco — o trigger impede
    // sobrescrevê-la justamente para preservar essa comparação.
    const { status, erro: falha } = await confirmarPrazo(
      prazo.id, dataFinal, prazo.data_vencimento_sugerida, usuario.id,
    );
    setSalvando(null);
    if (falha) {
      setErro(falha);
      return;
    }
    setAjustando(null);
    setAviso(
      status === 'ajustado'
        ? `Prazo confirmado com a data ajustada para ${formatarData(dataFinal)}.`
        : `Prazo confirmado para ${formatarData(dataFinal)}.`
    );
    await carregar();
  }

  const autorizado = podeConfirmarPrazo(usuario);

  return (
    <>
      <h1 className="text-xl font-semibold text-slate-900">
        Prazos sugeridos, aguardando confirmação
      </h1>
      <p className="mt-1 max-w-2xl text-sm text-slate-600">
        O sistema calcula e propõe. Nada aqui é compromisso do escritório antes
        de um advogado conferir a conta e confirmar.
      </p>

      {/* aria-live="polite" anuncia o resultado da ação sem interromper quem
          está navegando. Sem isso, quem usa leitor de tela confirma o prazo e
          não recebe retorno nenhum. */}
      <p aria-live="polite" className="sr-only">{aviso}</p>
      {aviso && (
        <p className="mt-4 rounded-md bg-green-50 px-3 py-2 text-sm
                      font-medium text-green-900">
          {aviso}
        </p>
      )}
      {erro && (
        <p role="alert" className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm
                                   font-medium text-red-800">
          {erro}
        </p>
      )}

      {!autorizado && (
        <p className="mt-4 rounded-md bg-amber-50 px-3 py-3 text-sm
                      text-amber-900">
          Seu papel no escritório permite acompanhar a fila, mas não confirmar
          prazo — transformar sugestão em compromisso é ato de advogado. Quem
          confirma vê os mesmos itens com os botões de confirmação.
        </p>
      )}

      {carregando && <p className="mt-6 text-slate-600">Carregando…</p>}

      {!carregando && prazos.length === 0 && (
        <p className="mt-6 rounded-md border border-slate-200 bg-white px-4
                      py-6 text-slate-700">
          Nenhuma sugestão aguardando confirmação.
        </p>
      )}

      <ul className="mt-6 space-y-4">
        {prazos.map((prazo) => {
          const dias = diasCorridosAte(prazo.data_vencimento_sugerida);
          const urgente = dias !== null && dias <= 3;
          return (
            <li key={prazo.id}
                className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="flex flex-wrap items-start gap-x-6 gap-y-2">
                <div className="min-w-48">
                  <span className="block text-xs uppercase tracking-wide
                                   text-slate-500">
                    Processo
                  </span>
                  <span className="block font-medium text-slate-900">
                    {prazo.processos?.numero_cnj
                      ?? prazo.processos?.numero_pasta
                      ?? 'sem número'}
                  </span>
                  {prazo.processos?.tribunal && (
                    <span className="block text-sm text-slate-600">
                      {prazo.processos.tribunal}
                    </span>
                  )}
                </div>

                <div>
                  <span className="block text-xs uppercase tracking-wide
                                   text-slate-500">
                    Vencimento sugerido
                  </span>
                  <span className={[
                    'block font-medium',
                    urgente ? 'text-red-700' : 'text-slate-900',
                  ].join(' ')}>
                    {formatarData(prazo.data_vencimento_sugerida)}
                  </span>
                  {dias !== null && (
                    <span className="block text-sm text-slate-600">
                      {dias < 0
                        ? `${Math.abs(dias)} ${Math.abs(dias) === 1
                            ? 'dia atrás' : 'dias atrás'}`
                        : dias === 0 ? 'hoje'
                        : `em ${dias} ${dias === 1 ? 'dia' : 'dias'}`}
                    </span>
                  )}
                </div>

                {/* A conta, ao lado da data. É o que permite conferir em vez
                    de acreditar. */}
                <div>
                  <span className="block text-xs uppercase tracking-wide
                                   text-slate-500">
                    Como foi contado
                  </span>
                  <span className="block text-sm text-slate-800">
                    {prazo.dias ?? '—'}{' '}
                    {prazo.contagem === 'dias_uteis' ? 'dias úteis'
                      : prazo.contagem === 'dias_corridos' ? 'dias corridos'
                      : ''}
                    {prazo.em_dobro && ' · em dobro'}
                  </span>
                  <span className="block text-sm text-slate-600">
                    início da contagem:{' '}
                    {formatarData(prazo.data_inicio_contagem)}
                  </span>
                </div>
              </div>

              {(prazo.fundamento_legal || prazo.fundamento_dobro) && (
                <p className="mt-3 text-sm text-slate-700">
                  <span className="font-medium">Fundamento:</span>{' '}
                  {prazo.fundamento_legal}
                  {prazo.fundamento_dobro && ` · dobra: ${prazo.fundamento_dobro}`}
                </p>
              )}

              {autorizado && (
                <div className="mt-4 border-t border-slate-100 pt-4">
                  {ajustando === prazo.id ? (
                    <form
                      className="flex flex-wrap items-end gap-3"
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (dataAjustada) void confirmar(prazo, dataAjustada);
                      }}
                    >
                      <div>
                        <label
                          htmlFor={`data-${prazo.id}`}
                          className="block text-sm font-medium text-slate-700"
                        >
                          Data correta do vencimento
                        </label>
                        <input
                          id={`data-${prazo.id}`} type="date" required
                          value={dataAjustada}
                          onChange={(e) => setDataAjustada(e.target.value)}
                          className="mt-1 rounded-md border border-slate-300
                                     px-3 py-2"
                        />
                      </div>
                      <button
                        type="submit" disabled={salvando === prazo.id}
                        className="rounded-md bg-sky-700 px-3 py-2 text-sm
                                   font-medium text-white hover:bg-sky-800
                                   disabled:opacity-60"
                      >
                        Confirmar com esta data
                      </button>
                      <button
                        type="button" onClick={() => setAjustando(null)}
                        className="rounded-md border border-slate-300 px-3
                                   py-2 text-sm font-medium text-slate-700"
                      >
                        Cancelar
                      </button>
                    </form>
                  ) : (
                    <div className="flex flex-wrap gap-3">
                      <button
                        type="button"
                        disabled={salvando === prazo.id
                                  || !prazo.data_vencimento_sugerida}
                        onClick={() => {
                          if (prazo.data_vencimento_sugerida) {
                            void confirmar(prazo, prazo.data_vencimento_sugerida);
                          }
                        }}
                        className="rounded-md bg-sky-700 px-3 py-2 text-sm
                                   font-medium text-white hover:bg-sky-800
                                   disabled:opacity-60"
                      >
                        {salvando === prazo.id
                          ? 'Confirmando…'
                          : 'Conferi: a data está correta'}
                      </button>
                      {/* Mesmo peso visual que confirmar, de propósito.
                          Esconder o ajuste num link empurraria para o aceite
                          por inércia, que é o oposto do que a confirmação
                          humana existe para garantir. */}
                      <button
                        type="button"
                        onClick={() => {
                          setAjustando(prazo.id);
                          setDataAjustada(prazo.data_vencimento_sugerida ?? '');
                        }}
                        className="rounded-md border border-slate-400 px-3
                                   py-2 text-sm font-medium text-slate-800
                                   hover:bg-slate-50"
                      >
                        A data está errada: ajustar
                      </button>
                    </div>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}
