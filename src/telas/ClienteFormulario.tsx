import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { obterCliente, salvarCliente } from '../banco/dados';
import { useSessao } from '../banco/sessao';
import { apenasDigitos } from '../banco/tipos';
import {
  AreaDeTexto, Botao, Campo, Carregando, Entrada, Erro, Selecao,
} from '../componentes/Formulario';

const VAZIO = {
  tipo_pessoa: 'fisica', nome: '', nome_social: '', documento: '', email: '',
  telefone: '', cep: '', logradouro: '', numero: '', complemento: '',
  bairro: '', municipio: '', uf: '', observacoes: '',
};

export function ClienteFormulario() {
  const { id } = useParams();
  const editando = Boolean(id);
  const { usuario } = useSessao();
  const navegar = useNavigate();
  const [form, setForm] = useState(VAZIO);
  const [carregando, setCarregando] = useState(editando);
  const [erro, setErro] = useState<string | null>(null);
  const [erroDoc, setErroDoc] = useState<string | undefined>(undefined);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!id) return;
    void obterCliente(id).then(({ dados, erro: falha }) => {
      if (falha) setErro(falha);
      if (dados) {
        setForm({
          tipo_pessoa: dados.tipo_pessoa, nome: dados.nome,
          nome_social: dados.nome_social ?? '',
          documento: dados.documento ?? '', email: dados.email ?? '',
          telefone: dados.telefone ?? '', cep: dados.cep ?? '',
          logradouro: dados.logradouro ?? '', numero: dados.numero ?? '',
          complemento: dados.complemento ?? '', bairro: dados.bairro ?? '',
          municipio: dados.municipio ?? '', uf: dados.uf ?? '',
          observacoes: dados.observacoes ?? '',
        });
      }
      setCarregando(false);
    });
  }, [id]);

  async function enviar(evento: React.FormEvent) {
    evento.preventDefault();
    if (!usuario) return;
    setErroDoc(undefined);

    const doc = apenasDigitos(form.documento);
    // Validação de tamanho no cliente só para dar mensagem útil na hora. Quem
    // garante é o domínio documento_fiscal no banco — e é bom que seja assim,
    // porque a Edge Function e qualquer script também passam por lá.
    if (doc !== '' && doc.length !== 11 && doc.length !== 14) {
      setErroDoc('CPF tem 11 dígitos e CNPJ tem 14. Confira o número.');
      document.getElementById('documento')?.focus();
      return;
    }

    setSalvando(true);
    setErro(null);
    const { dados, erro: falha } = await salvarCliente({
      ...(editando ? {} : { escritorio_id: usuario.escritorio_id,
                            criado_por: usuario.id } as never),
      tipo_pessoa: form.tipo_pessoa as never,
      nome: form.nome,
      nome_social: form.nome_social || null,
      documento: doc === '' ? null : doc,
      email: form.email || null,
      telefone: form.telefone || null,
      cep: apenasDigitos(form.cep) || null,
      logradouro: form.logradouro || null,
      numero: form.numero || null,
      complemento: form.complemento || null,
      bairro: form.bairro || null,
      municipio: form.municipio || null,
      uf: form.uf || null,
      observacoes: form.observacoes || null,
    } as never, id);

    setSalvando(false);
    if (falha) { setErro(falha); return; }
    navegar('/clientes', { state: { salvo: dados?.nome } });
  }

  if (carregando) return <Carregando />;

  return (
    <>
      <h1 className="text-xl font-semibold text-slate-900">
        {editando ? 'Editar cliente' : 'Novo cliente'}
      </h1>
      <Erro>{erro}</Erro>

      <form onSubmit={enviar} className="mt-6 max-w-3xl space-y-5">
        <div className="grid gap-5 sm:grid-cols-2">
          <Campo id="tipo_pessoa" rotulo="Tipo" obrigatorio>
            <Selecao id="tipo_pessoa" value={form.tipo_pessoa}
                     onChange={(e) => setForm({ ...form,
                       tipo_pessoa: e.target.value })}>
              <option value="fisica">Pessoa física</option>
              <option value="juridica">Pessoa jurídica</option>
            </Selecao>
          </Campo>

          <Campo id="documento" rotulo={form.tipo_pessoa === 'fisica'
                                        ? 'CPF' : 'CNPJ'}
                 erro={erroDoc}
                 ajuda="Pode digitar com ou sem pontuação.">
            <Entrada id="documento" temAjuda temErro={Boolean(erroDoc)}
                     inputMode="numeric" value={form.documento}
                     onChange={(e) => setForm({ ...form,
                       documento: e.target.value })} />
          </Campo>

          <Campo id="nome" rotulo={form.tipo_pessoa === 'fisica'
                                   ? 'Nome completo' : 'Razão social'}
                 obrigatorio>
            <Entrada id="nome" required value={form.nome}
                     onChange={(e) => setForm({ ...form,
                       nome: e.target.value })} />
          </Campo>

          <Campo id="nome_social" rotulo={form.tipo_pessoa === 'fisica'
                                          ? 'Nome social ou como prefere ser chamado'
                                          : 'Nome fantasia'}>
            <Entrada id="nome_social" value={form.nome_social}
                     onChange={(e) => setForm({ ...form,
                       nome_social: e.target.value })} />
          </Campo>

          <Campo id="email" rotulo="E-mail">
            <Entrada id="email" type="email" value={form.email}
                     onChange={(e) => setForm({ ...form,
                       email: e.target.value })} />
          </Campo>

          <Campo id="telefone" rotulo="Telefone">
            <Entrada id="telefone" type="tel" value={form.telefone}
                     onChange={(e) => setForm({ ...form,
                       telefone: e.target.value })} />
          </Campo>
        </div>

        <fieldset className="space-y-5 rounded-lg border border-slate-200 p-4">
          <legend className="px-1 text-sm font-semibold text-slate-800">
            Endereço
          </legend>
          <div className="grid gap-5 sm:grid-cols-3">
            <Campo id="cep" rotulo="CEP">
              <Entrada id="cep" inputMode="numeric" value={form.cep}
                       onChange={(e) => setForm({ ...form,
                         cep: e.target.value })} />
            </Campo>
            <Campo id="logradouro" rotulo="Logradouro">
              <Entrada id="logradouro" value={form.logradouro}
                       onChange={(e) => setForm({ ...form,
                         logradouro: e.target.value })} />
            </Campo>
            <Campo id="numero" rotulo="Número">
              <Entrada id="numero" value={form.numero}
                       onChange={(e) => setForm({ ...form,
                         numero: e.target.value })} />
            </Campo>
            <Campo id="complemento" rotulo="Complemento">
              <Entrada id="complemento" value={form.complemento}
                       onChange={(e) => setForm({ ...form,
                         complemento: e.target.value })} />
            </Campo>
            <Campo id="bairro" rotulo="Bairro">
              <Entrada id="bairro" value={form.bairro}
                       onChange={(e) => setForm({ ...form,
                         bairro: e.target.value })} />
            </Campo>
            <Campo id="municipio" rotulo="Município">
              <Entrada id="municipio" value={form.municipio}
                       onChange={(e) => setForm({ ...form,
                         municipio: e.target.value })} />
            </Campo>
            <Campo id="uf_cliente" rotulo="UF">
              <Entrada id="uf_cliente" maxLength={2} value={form.uf}
                       onChange={(e) => setForm({ ...form,
                         uf: e.target.value.toUpperCase() })} />
            </Campo>
          </div>
        </fieldset>

        <Campo id="observacoes" rotulo="Observações internas"
               ajuda="Anotações do escritório. O cliente não vê este campo no portal.">
          <AreaDeTexto id="observacoes" value={form.observacoes}
                       onChange={(e) => setForm({ ...form,
                         observacoes: e.target.value })} />
        </Campo>

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
