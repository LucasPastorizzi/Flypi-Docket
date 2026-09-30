import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { lancarPrazoManual } from '../banco/dados';
import { podeConfirmarPrazo, useSessao } from '../banco/sessao';
import {
  AreaDeTexto, Botao, Campo, Entrada, Erro, Selecao,
} from '../componentes/Formulario';

// Lançamento manual de prazo.
//
// É o caminho que existe HOJE, e vai continuar existindo depois que o robô de
// publicações entrar: intimação chega por outros meios além do diário, e o
// advogado precisa poder lançar o que apurou.
//
// A diferença em relação ao prazo sugerido pelo sistema está em quem assume a
// conta. Aqui quem calculou foi o advogado, então o prazo já nasce confirmado
// por ele — não faria sentido pedir que confirmasse a própria conta. O
// fundamento legal é obrigatório pelo mesmo motivo que em regras_prazo: data
// sem o artigo que a sustenta não dá para conferir depois.
export function PrazoFormulario() {
  const { id: processoId = '' } = useParams();
  const { usuario } = useSessao();
  const navegar = useNavigate();
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [form, setForm] = useState({
    contagem: 'dias_uteis', dias: '', data_termo_inicial: '',
    data_inicio_contagem: '', data_vencimento: '', em_dobro: false,
    fundamento_dobro: '', fundamento_legal: '', observacao: '',
  });

  if (!podeConfirmarPrazo(usuario)) {
    return (
      <p className="mt-6 rounded-md bg-amber-50 px-4 py-4 text-amber-900">
        Lançar prazo é ato de advogado. Seu papel no escritório não permite —
        peça a quem responde pelo caso.
      </p>
    );
  }

  async function enviar(evento: React.FormEvent) {
    evento.preventDefault();
    if (!usuario) return;
    setSalvando(true);
    setErro(null);
    const agora = new Date().toISOString();
    const { erro: falha } = await lancarPrazoManual({
      escritorio_id: usuario.escritorio_id,
      processo_id: processoId,
      origem: 'manual',
      contagem: form.contagem,
      dias: form.dias ? Number(form.dias) : null,
      em_dobro: form.em_dobro,
      fundamento_dobro: form.em_dobro ? form.fundamento_dobro : null,
      data_termo_inicial: form.data_termo_inicial || null,
      data_inicio_contagem: form.data_inicio_contagem || null,
      // Lançamento manual: a data apurada pelo advogado é a confirmada, e a
      // coluna de sugestão fica vazia — não houve sugestão do sistema para
      // comparar. Preenchê-la com a mesma data fingiria uma conferência que
      // não aconteceu e sujaria a estatística de acerto das regras.
      data_vencimento_confirmada: form.data_vencimento,
      status: 'confirmado',
      confirmado_por: usuario.id,
      confirmado_em: agora,
      responsavel_id: usuario.id,
      fundamento_legal: form.fundamento_legal,
      observacao: form.observacao || null,
    });
    setSalvando(false);
    if (falha) { setErro(falha); return; }
    navegar(`/processos/${processoId}`);
  }

  return (
    <>
      <h1 className="text-xl font-semibold text-slate-900">Lançar prazo</h1>
      <p className="mt-1 max-w-2xl text-sm text-slate-600">
        Para intimação que chegou por fora do diário, ou prazo que você apurou.
        Como a conta é sua, ele já entra como compromisso — no seu nome.
      </p>

      <Erro>{erro}</Erro>

      <form onSubmit={enviar} className="mt-6 max-w-2xl space-y-5">
        <div className="grid gap-5 sm:grid-cols-2">
          <Campo id="data_termo_inicial" rotulo="Data do ato"
                 ajuda="A publicação, a intimação ou a ciência que dispara a contagem.">
            <Entrada id="data_termo_inicial" type="date" temAjuda
                     value={form.data_termo_inicial}
                     onChange={(e) => setForm({ ...form,
                       data_termo_inicial: e.target.value })} />
          </Campo>

          <Campo id="data_inicio_contagem" rotulo="Início da contagem"
                 ajuda="Costuma ser o dia útil seguinte ao ato — o art. 224 do CPC exclui o dia do começo.">
            <Entrada id="data_inicio_contagem" type="date" temAjuda
                     value={form.data_inicio_contagem}
                     onChange={(e) => setForm({ ...form,
                       data_inicio_contagem: e.target.value })} />
          </Campo>

          <Campo id="contagem" rotulo="Tipo de contagem" obrigatorio
                 ajuda="Prazo processual conta em dias úteis (art. 219 do CPC); prazo material, em dias corridos.">
            <Selecao id="contagem" value={form.contagem}
                     onChange={(e) => setForm({ ...form,
                       contagem: e.target.value })}>
              <option value="dias_uteis">Dias úteis</option>
              <option value="dias_corridos">Dias corridos</option>
            </Selecao>
          </Campo>

          <Campo id="dias" rotulo="Quantidade de dias">
            <Entrada id="dias" type="number" min={1} value={form.dias}
                     onChange={(e) => setForm({ ...form,
                       dias: e.target.value })} />
          </Campo>

          <Campo id="data_vencimento" rotulo="Vencimento" obrigatorio
                 ajuda="A data que você apurou. É ela que vira compromisso na agenda.">
            <Entrada id="data_vencimento" type="date" required temAjuda
                     value={form.data_vencimento}
                     onChange={(e) => setForm({ ...form,
                       data_vencimento: e.target.value })} />
          </Campo>
        </div>

        <fieldset className="space-y-3 rounded-lg border border-slate-200 p-4">
          <legend className="px-1 text-sm font-semibold text-slate-800">
            Prazo em dobro
          </legend>
          <label className="flex items-center gap-2 text-sm text-slate-800">
            <input type="checkbox" checked={form.em_dobro} className="size-4"
                   onChange={(e) => setForm({ ...form,
                     em_dobro: e.target.checked })} />
            Este prazo corre em dobro
          </label>
          {form.em_dobro && (
            <Campo id="fundamento_dobro" rotulo="Por quê" obrigatorio
                   ajuda="Litisconsortes com procuradores distintos, Defensoria, Fazenda Pública…">
              <Entrada id="fundamento_dobro" required temAjuda
                       value={form.fundamento_dobro}
                       onChange={(e) => setForm({ ...form,
                         fundamento_dobro: e.target.value })} />
            </Campo>
          )}
        </fieldset>

        <Campo id="fundamento_legal" rotulo="Fundamento legal" obrigatorio
               ajuda="O artigo que sustenta este prazo. Data sem fundamento não dá para conferir depois.">
          <Entrada id="fundamento_legal" required temAjuda
                   value={form.fundamento_legal}
                   onChange={(e) => setForm({ ...form,
                     fundamento_legal: e.target.value })} />
        </Campo>

        <Campo id="observacao" rotulo="Observação">
          <AreaDeTexto id="observacao" value={form.observacao}
                       onChange={(e) => setForm({ ...form,
                         observacao: e.target.value })} />
        </Campo>

        <div className="flex gap-3">
          <Botao type="submit" disabled={salvando}>
            {salvando ? 'Salvando…' : 'Lançar prazo'}
          </Botao>
          <Botao variante="secundario" onClick={() => navegar(-1)}>
            Cancelar
          </Botao>
        </div>
      </form>
      <div className="h-10" />
    </>
  );
}
