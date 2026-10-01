import { useCallback, useEffect, useState } from 'react';
import {
  excluirFeriado, listarFeriadosDoEscritorio, listarTribunais, salvarFeriado,
} from '../banco/dados';
import { useSessao } from '../banco/sessao';
import {
  formatarData, type FeriadoEscritorio, type Tribunal,
} from '../banco/tipos';
import {
  Botao, Campo, Carregando, Entrada, Erro, Selecao, Sucesso, Vazio,
} from '../componentes/Formulario';

// Cumpre o critério de aceite "feriado novo é cadastrado pela interface, sem
// deploy".
//
// O motivo está no briefing: portaria de tribunal sai no meio do ano, e se o
// cadastro depender de release, um esquecimento vira prazo perdido. Esta tela
// é a diferença entre "avisa a gente que a gente publica" e "cadastra agora".
export function Feriados() {
  const { usuario } = useSessao();
  const [feriados, setFeriados] = useState<FeriadoEscritorio[]>([]);
  const [tribunais, setTribunais] = useState<Tribunal[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [form, setForm] = useState({
    abrangencia: 'tribunal', tribunal: '', uf: '', municipio: '',
    data_inicio: '', data_fim: '', efeito: 'dia_nao_util', descricao: '',
    fundamento: '', fonte_url: '',
  });

  const carregar = useCallback(async () => {
    const { dados, erro: falha } = await listarFeriadosDoEscritorio();
    if (falha) setErro(falha); else setFeriados(dados);
    setCarregando(false);
  }, []);

  useEffect(() => {
    void carregar();
    void listarTribunais().then((r) => setTribunais(r.dados));
  }, [carregar]);

  const podeCadastrar = usuario?.admin_escritorio
                     || usuario?.papel === 'advogado_responsavel';

  async function enviar(evento: React.FormEvent) {
    evento.preventDefault();
    if (!usuario) return;
    setErro(null);
    const { erro: falha } = await salvarFeriado({
      escritorio_id: usuario.escritorio_id,
      abrangencia: form.abrangencia as never,
      // O schema tem um check que exige a combinação certa por abrangência:
      // municipal precisa de UF e município, estadual só de UF, e assim por
      // diante. Mandar o que não corresponde é recusado no banco — um feriado
      // municipal sem município se aplicaria a todo mundo.
      tribunal: form.abrangencia === 'tribunal' ? form.tribunal : null,
      uf: ['estadual', 'municipal'].includes(form.abrangencia)
        ? form.uf : null,
      municipio: form.abrangencia === 'municipal' ? form.municipio : null,
      data_inicio: form.data_inicio,
      // Feriado de um dia tem início e fim iguais. O modelo é de intervalo
      // porque o recesso forense são trinta e dois dias seguidos, e uma linha
      // por dia seria trinta e duas chances de errar.
      data_fim: form.data_fim || form.data_inicio,
      efeito: form.efeito as never,
      descricao: form.descricao,
      fundamento: form.fundamento,
      fonte_url: form.fonte_url || null,
      criado_por: usuario.id,
    } as never);

    if (falha) { setErro(falha); return; }
    setAviso('Feriado cadastrado. Ele já vale para os próximos cálculos.');
    setForm({ ...form, data_inicio: '', data_fim: '', descricao: '',
              fundamento: '', fonte_url: '' });
    await carregar();
  }

  return (
    <>
      <h1 className="text-xl font-semibold text-slate-900">
        Calendário do escritório
      </h1>
      <p className="mt-1 max-w-3xl text-sm text-slate-600">
        Feriados nacionais e as portarias que a Flypi acompanha já entram
        sozinhos. Aqui ficam as <strong>exceções da sua comarca</strong> — o
        feriado municipal, a portaria que acabou de sair e ainda não chegou ao
        catálogo. O que você cadastrar vale para o cálculo de prazo do seu
        escritório, e de mais ninguém.
      </p>

      <Erro>{erro}</Erro>
      <Sucesso>{aviso}</Sucesso>

      {podeCadastrar && (
        <form onSubmit={enviar}
              className="mt-6 max-w-3xl space-y-5 rounded-lg border
                         border-slate-200 bg-white p-4">
          <h2 className="font-semibold text-slate-900">Cadastrar</h2>

          <div className="grid gap-5 sm:grid-cols-2">
            <Campo id="abrangencia" rotulo="Vale para" obrigatorio>
              <Selecao id="abrangencia" value={form.abrangencia}
                       onChange={(e) => setForm({ ...form,
                         abrangencia: e.target.value })}>
                <option value="tribunal">Um tribunal</option>
                <option value="municipal">Um município</option>
                <option value="estadual">Um estado</option>
                <option value="nacional">Todo o país</option>
              </Selecao>
            </Campo>

            {form.abrangencia === 'tribunal' && (
              <Campo id="tribunal" rotulo="Tribunal" obrigatorio>
                <Selecao id="tribunal" required value={form.tribunal}
                         onChange={(e) => setForm({ ...form,
                           tribunal: e.target.value })}>
                  <option value="">Escolha…</option>
                  {tribunais.map((t) => (
                    <option key={t.sigla} value={t.sigla}>
                      {t.sigla} — {t.nome}
                    </option>
                  ))}
                </Selecao>
              </Campo>
            )}

            {['estadual', 'municipal'].includes(form.abrangencia) && (
              <Campo id="uf_feriado" rotulo="UF" obrigatorio>
                <Entrada id="uf_feriado" required maxLength={2} value={form.uf}
                         onChange={(e) => setForm({ ...form,
                           uf: e.target.value.toUpperCase() })} />
              </Campo>
            )}

            {form.abrangencia === 'municipal' && (
              <Campo id="municipio" rotulo="Município" obrigatorio>
                <Entrada id="municipio" required value={form.municipio}
                         onChange={(e) => setForm({ ...form,
                           municipio: e.target.value })} />
              </Campo>
            )}

            <Campo id="data_inicio" rotulo="De" obrigatorio>
              <Entrada id="data_inicio" type="date" required
                       value={form.data_inicio}
                       onChange={(e) => setForm({ ...form,
                         data_inicio: e.target.value })} />
            </Campo>

            <Campo id="data_fim" rotulo="Até"
                   ajuda="Deixe vazio se for um dia só.">
              <Entrada id="data_fim" type="date" temAjuda value={form.data_fim}
                       onChange={(e) => setForm({ ...form,
                         data_fim: e.target.value })} />
            </Campo>

            <Campo id="efeito" rotulo="Efeito na contagem" obrigatorio
                   ajuda="A diferença muda a conta e precisa de conferência jurídica.">
              <Selecao id="efeito" value={form.efeito}
                       onChange={(e) => setForm({ ...form,
                         efeito: e.target.value })}>
                <option value="dia_nao_util">
                  Dia não útil — não conta em prazo de dias úteis
                </option>
                <option value="suspende_prazo">
                  Suspende o prazo — a contagem para e depois volta
                </option>
              </Selecao>
            </Campo>
          </div>

          <Campo id="descricao" rotulo="Descrição" obrigatorio>
            <Entrada id="descricao" required value={form.descricao}
                     onChange={(e) => setForm({ ...form,
                       descricao: e.target.value })} />
          </Campo>

          <Campo id="fundamento" rotulo="Ato que sustenta" obrigatorio
                 ajuda='Ex.: "Portaria 123/2026 do TJRS", "Lei municipal 4.567". É o que permite conferir um cadastro suspeito antes de um prazo ser perdido por causa dele.'>
            <Entrada id="fundamento" required temAjuda value={form.fundamento}
                     onChange={(e) => setForm({ ...form,
                       fundamento: e.target.value })} />
          </Campo>

          <Campo id="fonte_url" rotulo="Link da fonte">
            <Entrada id="fonte_url" type="url" value={form.fonte_url}
                     onChange={(e) => setForm({ ...form,
                       fonte_url: e.target.value })} />
          </Campo>

          <Botao type="submit">Cadastrar feriado</Botao>
        </form>
      )}

      {carregando && <Carregando />}
      {!carregando && feriados.length === 0 && (
        <Vazio>Nenhuma exceção local cadastrada.</Vazio>
      )}

      {feriados.length > 0 && (
        <div className="mt-6 overflow-x-auto rounded-lg border border-slate-200
                        bg-white">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">
              Feriados e suspensões cadastrados pelo escritório
            </caption>
            <thead className="border-b border-slate-200 bg-slate-50">
              <tr>
                <th scope="col" className="px-4 py-3 font-semibold">Período</th>
                <th scope="col" className="px-4 py-3 font-semibold">Descrição</th>
                <th scope="col" className="px-4 py-3 font-semibold">Alcance</th>
                <th scope="col" className="px-4 py-3 font-semibold">Efeito</th>
                <th scope="col" className="px-4 py-3 font-semibold">Fundamento</th>
                <th scope="col" className="px-4 py-3"><span className="sr-only">Ações</span></th>
              </tr>
            </thead>
            <tbody>
              {feriados.map((f) => (
                <tr key={f.id} className="border-b border-slate-100 last:border-0">
                  <th scope="row" className="px-4 py-3 font-medium">
                    {formatarData(f.data_inicio)}
                    {f.data_fim !== f.data_inicio
                      && ` a ${formatarData(f.data_fim)}`}
                  </th>
                  <td className="px-4 py-3 text-slate-700">{f.descricao}</td>
                  <td className="px-4 py-3 text-slate-700">
                    {f.tribunal ?? f.municipio ?? f.uf ?? 'Nacional'}
                  </td>
                  <td className="px-4 py-3 text-slate-700">
                    {f.efeito === 'dia_nao_util' ? 'Dia não útil' : 'Suspende'}
                  </td>
                  <td className="px-4 py-3 text-slate-700">{f.fundamento}</td>
                  <td className="px-4 py-3">
                    {podeCadastrar && usuario && (
                      <Botao variante="perigo" onClick={async () => {
                        const { erro: fa } = await excluirFeriado(f.id, usuario.id);
                        if (fa) setErro(fa);
                        else { setAviso('Feriado removido.'); await carregar(); }
                      }}>
                        Remover
                      </Botao>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="h-10" />
    </>
  );
}
