import { useState } from 'react';
import { supabase } from '../banco/cliente';

export function Login() {
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function entrar(evento: React.FormEvent) {
    evento.preventDefault();
    setErro(null);
    setEnviando(true);
    const { error } = await supabase.auth.signInWithPassword({
      email, password: senha,
    });
    setEnviando(false);
    if (error) {
      // Mensagem genérica de propósito: distinguir "e-mail não existe" de
      // "senha errada" entrega a terceiros quem tem conta no sistema. Num
      // produto que guarda processo sob sigilo, a lista de quem é cliente de
      // qual escritório já é informação.
      setErro('E-mail ou senha incorretos.');
    }
  }

  return (
    <main className="min-h-dvh grid place-items-center bg-slate-50 px-4">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold text-slate-900">Flypi Docket</h1>
        <p className="mt-1 text-sm text-slate-600">
          Acesso da equipe do escritório.
        </p>

        <form onSubmit={entrar} className="mt-8 space-y-4">
          <div>
            {/* label com htmlFor, e não placeholder como rótulo: placeholder
                desaparece ao digitar e não é lido de forma confiável por
                leitor de tela. */}
            <label htmlFor="email"
                   className="block text-sm font-medium text-slate-700">
              E-mail
            </label>
            <input
              id="email" name="email" type="email" required
              autoComplete="username"
              value={email} onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3
                         py-2 text-slate-900"
            />
          </div>

          <div>
            <label htmlFor="senha"
                   className="block text-sm font-medium text-slate-700">
              Senha
            </label>
            <input
              id="senha" name="senha" type="password" required
              autoComplete="current-password"
              value={senha} onChange={(e) => setSenha(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3
                         py-2 text-slate-900"
            />
          </div>

          {/* role="alert" faz o leitor de tela anunciar o erro assim que ele
              aparece. Sem isso, quem não vê a tela preenche o formulário de
              novo sem saber que houve falha. */}
          {erro && (
            <p role="alert" className="text-sm font-medium text-red-700">
              {erro}
            </p>
          )}

          <button
            type="submit" disabled={enviando}
            className="w-full rounded-md bg-sky-700 px-3 py-2 font-medium
                       text-white hover:bg-sky-800 disabled:opacity-60"
          >
            {enviando ? 'Entrando…' : 'Entrar'}
          </button>
        </form>
      </div>
    </main>
  );
}
