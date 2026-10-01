import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { listarAgenda, marcarPrazoCumprido } from '../banco/dados';
import { podeConfirmarPrazo, useSessao } from '../banco/sessao';
import {
  diasCorridosAte, formatarCnj, formatarData, PAPEL_LEGIVEL,
  type PrazoDaFila,
} from '../banco/tipos';
import {
  Botao, Carregando, Erro, Sucesso, Vazio,
} from '../componentes/Formulario';

// A pauta — o que dá nome ao produto.
//
// Só entra aqui o que passou por confirmação humana. A fila de sugestões é
// outra tela, e a separação é o requisito inegociável do briefing em forma de
// navegação: se as duas listas fossem uma só, a sugestão não conferida teria
// o mesmo peso visual do compromisso assumido.
export function Agenda() {
  const { usuario } = useSessao();
  const [prazos, setPrazos] = useState<PrazoDaFila[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [soMeus, setSoMeus] = useState(false);

  const carregar = useCallback(async () => {
    const { dados, erro: falha } = await listarAgenda();
    if (falha) setErro(falha); else setPrazos(dados);
    setCarregando(false);
  }, []);

  useEffect(() => { void carregar(); }, [carregar]);

  const visiveis = prazos.filter((p) =>
    !soMeus || p.responsavel_id === usuario?.id);

  // Agrupa por urgência em vez de listar tudo em ordem. A pergunta do advogado
  // ao abrir a tela não é "quais são todos os prazos", é "o que vence agora".
  const grupos: Array<{ titulo: string; itens: PrazoDaFila[]; tom: string }> = [
    { titulo: 'Vencidos', itens: [], tom: 'text-red-800' },
    { titulo: 'Hoje e amanhã', itens: [], tom: 'text-red-700' },
    { titulo: 'Nos próximos 7 dias', itens: [], tom: 'text-amber-800' },
    { titulo: 'Depois', itens: [], tom: 'text-slate-700' },
  ];

  for (const prazo of visiveis) {
    const dias = diasCorridosAte(prazo.data_vencimento_confirmada);
    const alvo = dias === null ? 3
      : dias < 0 ? 0
      : dias <= 1 ? 1
      : dias <= 7 ? 2 : 3;
    grupos[alvo]?.itens.push(prazo);
  }

  return (
    <>
      <h1 className="text-xl font-semibold text-slate-900">Pauta</h1>
      <p className="mt-1 max-w-2xl text-sm text-slate-600">
        O que já é compromisso do escritório — prazo conferido e confirmado por
        um advogado. Sugestões aguardando confirmação ficam em{' '}
        <Link to="/prazos" className="text-sky-800 underline">Prazos</Link>.
      </p>

      <Erro>{erro}</Erro>
      <Sucesso>{aviso}</Sucesso>
      {carregando && <Carregando />}

      <label className="mt-4 flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" checked={soMeus} className="size-4"
               onChange={(e) => setSoMeus(e.target.checked)} />
        Mostrar só os prazos sob minha responsabilidade
      </label>
      <p aria-live="polite" className="sr-only">
        {visiveis.length} prazos na pauta
      </p>

      {!carregando && visiveis.length === 0 && (
        <Vazio>
          Nenhum compromisso na pauta. Prazo só entra aqui depois que um
          advogado confere a conta e confirma.
        </Vazio>
      )}

      {grupos.filter((g) => g.itens.length > 0).map((grupo) => (
        <section key={grupo.titulo} aria-labelledby={`g-${grupo.titulo}`}
                 className="mt-6">
          <h2 id={`g-${grupo.titulo}`}
              className={`text-sm font-semibold uppercase tracking-wide
                          ${grupo.tom}`}>
            {grupo.titulo} ({grupo.itens.length})
          </h2>
          <ul className="mt-2 divide-y divide-slate-100 rounded-lg border
                         border-slate-200 bg-white">
            {grupo.itens.map((prazo) => {
              const dias = diasCorridosAte(prazo.data_vencimento_confirmada);
              return (
                <li key={prazo.id} className="flex flex-wrap items-center
                                              gap-x-4 gap-y-1 px-4 py-3">
                  <span className="min-w-24 font-semibold text-slate-900">
                    {formatarData(prazo.data_vencimento_confirmada)}
                  </span>
                  <span className="text-sm text-slate-600">
                    {dias === null ? ''
                      : dias < 0 ? `${Math.abs(dias)} ${Math.abs(dias) === 1
                          ? 'dia atrás' : 'dias atrás'}`
                      : dias === 0 ? 'hoje'
                      : `em ${dias} ${dias === 1 ? 'dia' : 'dias'}`}
                  </span>
                  <Link to={`/processos/${prazo.processo_id}`}
                        className="text-sm text-sky-800 underline">
                    {formatarCnj(prazo.processos?.numero_cnj ?? null)}
                  </Link>
                  <span className="text-sm text-slate-600">
                    {prazo.dias} {prazo.contagem === 'dias_uteis'
                      ? 'dias úteis' : 'dias corridos'}
                    {prazo.em_dobro && ' · em dobro'}
                  </span>
                  {/* Status 'ajustado' aparece na pauta porque a divergência
                      entre o sugerido e o confirmado é informação útil: ela
                      indica regra de prazo que errou. */}
                  {prazo.status === 'ajustado' && (
                    <span className="rounded bg-slate-100 px-2 py-0.5 text-xs
                                     text-slate-700">
                      data ajustada na conferência
                    </span>
                  )}
                  {podeConfirmarPrazo(usuario) && (
                    <Botao variante="secundario" onClick={async () => {
                      const { erro: f } = await marcarPrazoCumprido(prazo.id);
                      if (f) setErro(f);
                      else {
                        setAviso('Prazo marcado como cumprido.');
                        await carregar();
                      }
                    }}>
                      Cumpri
                    </Botao>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      {usuario && (
        <p className="mt-8 text-sm text-slate-600">
          Você está vendo a pauta como {PAPEL_LEGIVEL[usuario.papel]} — o
          recorte dos processos é feito pelo banco, não por esta tela.
        </p>
      )}
      <div className="h-10" />
    </>
  );
}
