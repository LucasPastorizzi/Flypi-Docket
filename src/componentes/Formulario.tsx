import type { ReactNode } from 'react';

// Componentes de formulário com a acessibilidade embutida, e não opcional.
//
// A razão de existirem: label associado, erro anunciado e campo obrigatório
// marcado são coisas que se esquece uma vez a cada dez campos — e o décimo
// campo é o que quebra para quem usa leitor de tela. Concentrando aqui, o
// caminho fácil passa a ser o certo.

interface CampoProps {
  id: string;
  rotulo: string;
  obrigatorio?: boolean;
  ajuda?: string;
  erro?: string | undefined;
  children: ReactNode;
}

export function Campo({ id, rotulo, obrigatorio, ajuda, erro, children }: CampoProps) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-slate-700">
        {rotulo}
        {obrigatorio && (
          <>
            {' '}
            <span className="text-red-700" aria-hidden="true">*</span>
            <span className="sr-only">(obrigatório)</span>
          </>
        )}
      </label>
      {ajuda && (
        <p id={`${id}-ajuda`} className="mt-0.5 text-xs text-slate-600">
          {ajuda}
        </p>
      )}
      {children}
      {erro && (
        <p id={`${id}-erro`} role="alert"
           className="mt-1 text-sm font-medium text-red-700">
          {erro}
        </p>
      )}
    </div>
  );
}

const CLASSE_CONTROLE =
  'mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 ' +
  'text-slate-900 disabled:bg-slate-100 disabled:text-slate-500';

type PropsEntrada = React.InputHTMLAttributes<HTMLInputElement> & {
  id: string; temAjuda?: boolean; temErro?: boolean;
};

export function Entrada({ temAjuda, temErro, ...props }: PropsEntrada) {
  return (
    <input
      {...props}
      className={CLASSE_CONTROLE}
      // aria-describedby liga o campo ao texto de ajuda e à mensagem de erro,
      // que é o que faz o leitor de tela lê-los junto do campo em vez de
      // deixá-los soltos na página.
      aria-describedby={[
        temAjuda ? `${props.id}-ajuda` : null,
        temErro ? `${props.id}-erro` : null,
      ].filter(Boolean).join(' ') || undefined}
      aria-invalid={temErro || undefined}
    />
  );
}

type PropsSelecao = React.SelectHTMLAttributes<HTMLSelectElement> & {
  id: string; temErro?: boolean;
};

export function Selecao({ temErro, children, ...props }: PropsSelecao) {
  return (
    <select {...props} className={CLASSE_CONTROLE}
            aria-describedby={temErro ? `${props.id}-erro` : undefined}
            aria-invalid={temErro || undefined}>
      {children}
    </select>
  );
}

type PropsTexto = React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  id: string;
};

export function AreaDeTexto(props: PropsTexto) {
  return <textarea {...props} rows={props.rows ?? 3} className={CLASSE_CONTROLE} />;
}

export function Botao({
  variante = 'principal', ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variante?: 'principal' | 'secundario' | 'perigo';
}) {
  const estilos = {
    principal: 'bg-sky-700 text-white hover:bg-sky-800',
    secundario: 'border border-slate-400 text-slate-800 hover:bg-slate-50',
    perigo: 'border border-red-400 text-red-800 hover:bg-red-50',
  };
  return (
    <button
      type={props.type ?? 'button'}
      {...props}
      className={`rounded-md px-3 py-2 text-sm font-medium
                  disabled:opacity-60 ${estilos[variante]}`}
    />
  );
}

// Mensagens de resultado.
//
// `role="alert"` no erro porque falha precisa interromper; `aria-live="polite"`
// no sucesso porque confirmação pode esperar a frase atual terminar. Usar
// alert nos dois cortaria a fala do leitor de tela a cada ação bem-sucedida.
export function Erro({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm
                               font-medium text-red-800">
      {children}
    </p>
  );
}

export function Sucesso({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p aria-live="polite" className="mt-4 rounded-md bg-green-50 px-3 py-2
                                     text-sm font-medium text-green-900">
      {children}
    </p>
  );
}

export function Vazio({ children }: { children: ReactNode }) {
  return (
    <p className="mt-6 rounded-md border border-slate-200 bg-white px-4 py-6
                  text-slate-700">
      {children}
    </p>
  );
}

export function Carregando() {
  return <p aria-live="polite" className="mt-6 text-slate-600">Carregando…</p>;
}
