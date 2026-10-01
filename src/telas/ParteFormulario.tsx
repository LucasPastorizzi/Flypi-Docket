import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { listarClientes, salvarParte } from '../banco/dados';
import { useSessao } from '../banco/sessao';
import { apenasDigitos, type Cliente } from '../banco/tipos';
import { Botao, Campo, Entrada, Erro, Selecao } from '../componentes/Formulario';

export function ParteFormulario() {
  const { id: processoId = '' } = useParams();
  const { usuario } = useSessao();
  const navegar = useNavigate();
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [form, setForm] = useState({
    polo: 'ativo', qualificacao: '', nome: '', documento: '', cliente_id: '',
  });

  useEffect(() => {
    void listarClientes().then((r) => setClientes(r.dados));
  }, []);

  async function enviar(evento: React.FormEvent) {
    evento.preventDefault();
    if (!usuario) return;
    setSalvando(true);
    setErro(null);
    const { erro: falha } = await salvarParte({
      escritorio_id: usuario.escritorio_id,
      processo_id: processoId,
      polo: form.polo as never,
      qualificacao: form.qualificacao,
      nome: form.nome,
      documento: apenasDigitos(form.documento) || null,
      // Vazio vira null: a parte adversa não aponta para cliente nenhum, e é
      // essa ausência que a distingue. Não é dado faltando.
      cliente_id: form.cliente_id || null,
    });
    setSalvando(false);
    if (falha) { setErro(falha); return; }
    navegar(`/processos/${processoId}`);
  }

  return (
    <>
      <h1 className="text-xl font-semibold text-slate-900">Adicionar parte</h1>
      <p className="mt-1 max-w-2xl text-sm text-slate-600">
        Cadastre também a parte adversa. Ela é parte do processo sem ser
        cliente de ninguém — e é por essa distinção que o portal sabe o que
        mostrar a quem.
      </p>

      <Erro>{erro}</Erro>

      <form onSubmit={enviar} className="mt-6 max-w-2xl space-y-5">
        <div className="grid gap-5 sm:grid-cols-2">
          <Campo id="polo" rotulo="Polo" obrigatorio>
            <Selecao id="polo" value={form.polo}
                     onChange={(e) => setForm({ ...form,
                       polo: e.target.value })}>
              <option value="ativo">Polo ativo</option>
              <option value="passivo">Polo passivo</option>
              <option value="terceiro">Terceiro</option>
            </Selecao>
          </Campo>

          <Campo id="qualificacao" rotulo="Qualificação" obrigatorio
                 ajuda="Autor, ré, exequente, reclamada, terceiro interessado…">
            <Entrada id="qualificacao" temAjuda required
                     value={form.qualificacao}
                     onChange={(e) => setForm({ ...form,
                       qualificacao: e.target.value })} />
          </Campo>

          <Campo id="nome" rotulo="Nome da parte" obrigatorio>
            <Entrada id="nome" required value={form.nome}
                     onChange={(e) => setForm({ ...form,
                       nome: e.target.value })} />
          </Campo>

          <Campo id="documento" rotulo="CPF ou CNPJ">
            <Entrada id="documento" inputMode="numeric" value={form.documento}
                     onChange={(e) => setForm({ ...form,
                       documento: e.target.value })} />
          </Campo>
        </div>

        <Campo id="cliente_id" rotulo="Esta parte é cliente do escritório?"
               ajuda="Vincular é o que permite, depois, liberar o portal desse processo para ele.">
          <Selecao id="cliente_id" value={form.cliente_id}
                   onChange={(e) => setForm({ ...form,
                     cliente_id: e.target.value })}>
            <option value="">Não — é parte adversa ou terceiro</option>
            {clientes.map((c) => (
              <option key={c.id} value={c.id}>{c.nome}</option>
            ))}
          </Selecao>
        </Campo>

        <div className="flex gap-3">
          <Botao type="submit" disabled={salvando}>
            {salvando ? 'Salvando…' : 'Adicionar'}
          </Botao>
          <Botao variante="secundario" onClick={() => navegar(-1)}>
            Cancelar
          </Botao>
        </div>
      </form>
    </>
  );
}
