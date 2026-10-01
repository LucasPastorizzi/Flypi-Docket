import { useCallback, useEffect, useRef, useState } from 'react';
import {
  alternarVisibilidadeNoPortal, enviarDocumento, listarDocumentos,
  urlDoDocumento, type Documento,
} from '../banco/dados';
import { useSessao } from '../banco/sessao';
import { formatarInstante } from '../banco/tipos';
import { Botao, Campo, Erro, Sucesso } from './Formulario';

function tamanhoLegivel(bytes: number | null): string {
  if (bytes === null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function Documentos({ processoId }: { processoId: string }) {
  const { usuario } = useSessao();
  const [docs, setDocs] = useState<Documento[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [sigiloso, setSigiloso] = useState(false);
  const [visivelPortal, setVisivelPortal] = useState(false);
  const campoArquivo = useRef<HTMLInputElement>(null);

  const carregar = useCallback(async () => {
    const { dados, erro: falha } = await listarDocumentos(processoId);
    if (falha) setErro(falha); else setDocs(dados);
  }, [processoId]);

  useEffect(() => { void carregar(); }, [carregar]);

  async function enviar(evento: React.FormEvent) {
    evento.preventDefault();
    const arquivo = campoArquivo.current?.files?.[0];
    if (!arquivo || !usuario) return;
    setEnviando(true);
    setErro(null);
    const { erro: falha } = await enviarDocumento(
      arquivo, usuario.escritorio_id, processoId, usuario.id,
      { sigiloso, visivelPortal },
    );
    setEnviando(false);
    if (falha) { setErro(falha); return; }
    setAviso(`${arquivo.name} enviado.`);
    if (campoArquivo.current) campoArquivo.current.value = '';
    setSigiloso(false); setVisivelPortal(false);
    await carregar();
  }

  async function abrir(doc: Documento) {
    const { url, erro: falha } = await urlDoDocumento(doc.caminho);
    if (falha || !url) { setErro(falha ?? 'não consegui gerar o link'); return; }
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  return (
    <section aria-labelledby="t-docs" className="mt-8">
      <h2 id="t-docs" className="text-lg font-semibold text-slate-900">
        Documentos
      </h2>

      <Erro>{erro}</Erro>
      <Sucesso>{aviso}</Sucesso>

      {docs.length === 0 ? (
        <p className="mt-3 rounded-md border border-slate-200 bg-white px-4
                      py-4 text-sm text-slate-700">
          Nenhum documento neste processo.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-slate-100 rounded-lg border
                       border-slate-200 bg-white">
          {docs.map((doc) => (
            <li key={doc.id} className="flex flex-wrap items-center gap-x-3
                                        gap-y-1 px-4 py-3">
              <button type="button" onClick={() => void abrir(doc)}
                      className="font-medium text-sky-800 underline">
                {doc.nome_original}
              </button>
              <span className="text-sm text-slate-600">
                {tamanhoLegivel(doc.tamanho_bytes)} ·{' '}
                {formatarInstante(doc.criado_em)}
              </span>
              {doc.sigiloso && (
                <span className="rounded bg-amber-100 px-2 py-0.5 text-xs
                                 font-medium text-amber-900">
                  sigiloso
                </span>
              )}
              {/* O interruptor do portal, por documento. O processo ser do
                  cliente não faz toda peça ser dele: minuta, anotação interna
                  e estratégia moram no mesmo processo que a sentença. */}
              <label className="ml-auto flex items-center gap-2 text-sm
                                text-slate-700">
                <input
                  type="checkbox" className="size-4"
                  checked={doc.visivel_portal}
                  // Documento sigiloso nunca vai ao portal: o banco tem uma
                  // constraint que recusa a combinação, e a caixa fica
                  // desabilitada para a recusa não virar erro surpresa.
                  disabled={doc.sigiloso}
                  onChange={async (e) => {
                    const { erro: f } = await alternarVisibilidadeNoPortal(
                      doc.id, e.target.checked);
                    if (f) setErro(f);
                    else {
                      setAviso(e.target.checked
                        ? 'Documento liberado para o cliente no portal.'
                        : 'Documento retirado do portal.');
                      await carregar();
                    }
                  }}
                />
                visível no portal
              </label>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={enviar} className="mt-4 max-w-2xl space-y-4 rounded-lg
                                         border border-slate-200 bg-white p-4">
        <Campo id="arquivo" rotulo="Enviar documento">
          <input ref={campoArquivo} id="arquivo" type="file" required
                 className="mt-1 block w-full text-sm text-slate-700
                            file:mr-3 file:rounded-md file:border-0
                            file:bg-slate-100 file:px-3 file:py-2
                            file:text-sm file:font-medium" />
        </Campo>

        <div className="flex flex-wrap gap-6">
          <label className="flex items-center gap-2 text-sm text-slate-800">
            <input type="checkbox" className="size-4" checked={sigiloso}
                   onChange={(e) => {
                     setSigiloso(e.target.checked);
                     // Sigiloso e visível no portal são mutuamente exclusivos
                     // por constraint no banco. Desmarcar aqui evita montar um
                     // envio que o banco vai recusar depois do upload.
                     if (e.target.checked) setVisivelPortal(false);
                   }} />
            Documento sigiloso
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-800">
            <input type="checkbox" className="size-4" checked={visivelPortal}
                   disabled={sigiloso}
                   onChange={(e) => setVisivelPortal(e.target.checked)} />
            Já liberar para o cliente no portal
          </label>
        </div>

        <Botao type="submit" disabled={enviando}>
          {enviando ? 'Enviando…' : 'Enviar'}
        </Botao>
      </form>
    </section>
  );
}
