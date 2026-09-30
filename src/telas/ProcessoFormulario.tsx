import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { listarTribunais, obterProcesso, salvarProcesso } from '../banco/dados';
import { useSessao } from '../banco/sessao';
import { apenasDigitos, type Tribunal } from '../banco/tipos';
import {
  Botao, Campo, Carregando, Entrada, Erro, Selecao,
} from '../componentes/Formulario';

export function ProcessoFormulario() {
  const { id } = useParams();
  const editando = Boolean(id);
  const { usuario } = useSessao();
  const navegar = useNavigate();
  const [tribunais, setTribunais] = useState<Tribunal[]>([]);
  const [carregando, setCarregando] = useState(editando);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [form, setForm] = useState({
    numero_cnj: '', numero_pasta: '', tribunal: '', orgao_julgador: '',
    comarca: '', uf: '', classe: '', assunto: '', valor_causa: '',
    data_distribuicao: '', situacao: 'ativo', segredo_justica: false,
  });

  useEffect(() => {
    void listarTribunais().then((r) => setTribunais(r.dados));
  }, []);

  useEffect(() => {
    if (!id) return;
    void obterProcesso(id).then(({ dados, erro: falha }) => {
      if (falha) setErro(falha);
      if (dados) {
        setForm({
          numero_cnj: dados.numero_cnj ?? '',
          numero_pasta: dados.numero_pasta ?? '',
          tribunal: dados.tribunal ?? '',
          orgao_julgador: dados.orgao_julgador ?? '',
          comarca: dados.comarca ?? '',
          uf: dados.uf ?? '',
          classe: dados.classe ?? '',
          assunto: dados.assunto ?? '',
          valor_causa: dados.valor_causa ?? '',
          data_distribuicao: dados.data_distribuicao ?? '',
          situacao: dados.situacao,
          segredo_justica: dados.segredo_justica,
        });
      }
      setCarregando(false);
    });
  }, [id]);

  async function enviar(evento: React.FormEvent) {
    evento.preventDefault();
    if (!usuario) return;
    setSalvando(true);
    setErro(null);

    // Só dígitos: o banco guarda os 20 números sem pontuação, para casar com
    // o que a API do CNJ devolve sem precisar normalizar os dois lados a cada
    // consulta. O check do schema recusa qualquer outra coisa.
    const cnj = apenasDigitos(form.numero_cnj);

    const { dados, erro: falha } = await salvarProcesso({
      ...(editando ? {} : { escritorio_id: usuario.escritorio_id,
                            criado_por: usuario.id,
                            advogado_responsavel_id: usuario.id } as never),
      numero_cnj: cnj === '' ? null : cnj,
      numero_pasta: form.numero_pasta || null,
      tribunal: form.tribunal || null,
      orgao_julgador: form.orgao_julgador || null,
      comarca: form.comarca || null,
      uf: form.uf || null,
      classe: form.classe || null,
      assunto: form.assunto || null,
      // numeric aceita string, e é assim que tem que ir: converter para
      // number no caminho reintroduziria o ponto flutuante que o schema evita
      // ao exigir numeric.
      valor_causa: form.valor_causa || null,
      data_distribuicao: form.data_distribuicao || null,
      situacao: form.situacao as never,
      segredo_justica: form.segredo_justica,
    } as never, id);

    setSalvando(false);
    if (falha) { setErro(falha); return; }
    navegar(`/processos/${dados?.id ?? id}`);
  }

  if (carregando) return <Carregando />;

  return (
    <>
      <h1 className="text-xl font-semibold text-slate-900">
        {editando ? 'Editar processo' : 'Novo processo'}
      </h1>

      <Erro>{erro}</Erro>

      <form onSubmit={enviar} className="mt-6 max-w-3xl space-y-5">
        <div className="grid gap-5 sm:grid-cols-2">
          <Campo id="numero_cnj" rotulo="Número do processo (CNJ)"
                 ajuda="20 dígitos. A pontuação é ignorada.">
            <Entrada id="numero_cnj" temAjuda inputMode="numeric"
                     value={form.numero_cnj}
                     onChange={(e) => setForm({ ...form,
                       numero_cnj: e.target.value })} />
          </Campo>

          <Campo id="numero_pasta" rotulo="Pasta interna"
                 ajuda="Como o escritório chama o caso no dia a dia.">
            <Entrada id="numero_pasta" temAjuda value={form.numero_pasta}
                     onChange={(e) => setForm({ ...form,
                       numero_pasta: e.target.value })} />
          </Campo>

          <Campo id="tribunal" rotulo="Tribunal">
            <Selecao id="tribunal" value={form.tribunal}
                     onChange={(e) => setForm({ ...form,
                       tribunal: e.target.value })}>
              <option value="">Não informado</option>
              {tribunais.map((t) => (
                <option key={t.sigla} value={t.sigla}>
                  {t.sigla} — {t.nome}
                </option>
              ))}
            </Selecao>
          </Campo>

          <Campo id="orgao_julgador" rotulo="Órgão julgador"
                 ajuda="Vara, câmara ou turma.">
            <Entrada id="orgao_julgador" temAjuda value={form.orgao_julgador}
                     onChange={(e) => setForm({ ...form,
                       orgao_julgador: e.target.value })} />
          </Campo>

          <Campo id="comarca" rotulo="Comarca">
            <Entrada id="comarca" value={form.comarca}
                     onChange={(e) => setForm({ ...form,
                       comarca: e.target.value })} />
          </Campo>

          <Campo id="uf" rotulo="UF">
            <Entrada id="uf" maxLength={2} value={form.uf}
                     onChange={(e) => setForm({ ...form,
                       uf: e.target.value.toUpperCase() })} />
          </Campo>

          <Campo id="classe" rotulo="Classe processual">
            <Entrada id="classe" value={form.classe}
                     onChange={(e) => setForm({ ...form,
                       classe: e.target.value })} />
          </Campo>

          <Campo id="assunto" rotulo="Assunto">
            <Entrada id="assunto" value={form.assunto}
                     onChange={(e) => setForm({ ...form,
                       assunto: e.target.value })} />
          </Campo>

          <Campo id="valor_causa" rotulo="Valor da causa"
                 ajuda="Use ponto como separador decimal. Ex.: 48500.00">
            <Entrada id="valor_causa" temAjuda inputMode="decimal"
                     value={form.valor_causa}
                     onChange={(e) => setForm({ ...form,
                       valor_causa: e.target.value })} />
          </Campo>

          <Campo id="data_distribuicao" rotulo="Distribuição">
            <Entrada id="data_distribuicao" type="date"
                     value={form.data_distribuicao}
                     onChange={(e) => setForm({ ...form,
                       data_distribuicao: e.target.value })} />
          </Campo>

          <Campo id="situacao" rotulo="Situação">
            <Selecao id="situacao" value={form.situacao}
                     onChange={(e) => setForm({ ...form,
                       situacao: e.target.value })}>
              <option value="ativo">Ativo</option>
              <option value="suspenso">Suspenso</option>
              <option value="arquivado">Arquivado</option>
              <option value="baixado">Baixado</option>
              <option value="encerrado">Encerrado</option>
            </Selecao>
          </Campo>
        </div>

        {/* O interruptor de sigilo, com a consequência escrita ao lado. Marcar
            esta caixa tira o processo de toda consulta comum — inclusive para
            quem o cadastrou —, e quem marca precisa saber disso antes de
            salvar, não depois de procurar o caso e não achar. */}
        <fieldset className="rounded-lg border border-amber-300 bg-amber-50 p-4">
          <legend className="px-1 text-sm font-semibold text-amber-900">
            Sigilo
          </legend>
          <label className="flex items-start gap-3">
            <input
              type="checkbox" checked={form.segredo_justica}
              onChange={(e) => setForm({ ...form,
                segredo_justica: e.target.checked })}
              className="mt-1 size-4"
            />
            <span className="text-sm text-amber-900">
              <strong>Processo em segredo de justiça.</strong> Ele deixa de
              aparecer em qualquer listagem, para todo mundo, inclusive para
              você. A partir daí só abre pelo caminho que registra quem
              acessou, quando e de onde — e cada abertura vira uma linha na
              trilha de auditoria.
            </span>
          </label>
        </fieldset>

        <div className="flex gap-3">
          <Botao type="submit" disabled={salvando}>
            {salvando ? 'Salvando…' : 'Salvar'}
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
