import {
  createContext, useContext, useEffect, useMemo, useState, type ReactNode,
} from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './cliente';
import {
  MODO_DEMO, sairDoDemo, usuarioDemoAtual,
} from './demonstracao';
import type { UsuarioLogado } from './tipos';

// Duas coisas distintas, e a distinção importa: a SESSÃO é do GoTrue (quem
// autenticou), e o PERFIL é a linha de `usuarios` (qual escritório, qual
// papel). Estar autenticado não é estar autorizado — uma conta pode existir no
// Auth sem ter linha em `usuarios`, e nesse caso ela não é de ninguém do
// escritório e não deve ver nada.
interface Contexto {
  sessao: Session | null;
  usuario: UsuarioLogado | null;
  carregando: boolean;
  // Quando há sessão mas não há perfil. Não é erro de rede: é conta sem
  // vínculo, e a tela precisa dizer isso em vez de mostrar lista vazia.
  semVinculo: boolean;
  sair: () => Promise<void>;
}

const ContextoSessao = createContext<Contexto | null>(null);

export function ProvedorDeSessao({ children }: { children: ReactNode }) {
  // Em modo demonstração não há GoTrue, não há token e não há rede: o
  // "usuário logado" é uma escolha de perfil guardada em sessionStorage. O
  // ramo fica inteiro aqui, no começo, em vez de espalhado em condicionais —
  // assim dá para ler o provedor real sem tropeçar nele.
  if (MODO_DEMO) return <ProvedorDemo>{children}</ProvedorDemo>;

  return <ProvedorReal>{children}</ProvedorReal>;
}

function ProvedorDemo({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<UsuarioLogado | null>(usuarioDemoAtual);

  // Reage ao login de demonstração feito na tela de Login.
  useEffect(() => {
    const aoMudar = () => setUsuario(usuarioDemoAtual());
    window.addEventListener('flypi-demo-mudou', aoMudar);
    return () => window.removeEventListener('flypi-demo-mudou', aoMudar);
  }, []);

  const valor = useMemo<Contexto>(() => ({
    // Sessão falsa só para o App saber que há alguém logado. Nenhum token
    // real existe neste modo.
    sessao: usuario ? ({ user: { id: usuario.id } } as unknown as Session) : null,
    usuario,
    carregando: false,
    semVinculo: false,
    sair: async () => {
      sairDoDemo();
      setUsuario(null);
    },
  }), [usuario]);

  return (
    <ContextoSessao.Provider value={valor}>{children}</ContextoSessao.Provider>
  );
}

function ProvedorReal({ children }: { children: ReactNode }) {
  const [sessao, setSessao] = useState<Session | null>(null);
  const [usuario, setUsuario] = useState<UsuarioLogado | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [semVinculo, setSemVinculo] = useState(false);

  useEffect(() => {
    let ativo = true;

    // O perfil é lido com a sessão do próprio usuário, então passa pelo RLS —
    // e a policy de `usuarios` permite ler quem é do mesmo escritório. O
    // filtro por id é o que garante que é a própria linha.
    async function carregarPerfil(s: Session | null) {
      if (!s) {
        setUsuario(null);
        setSemVinculo(false);
        setCarregando(false);
        return;
      }
      const { data, error } = await supabase
        .from('usuarios')
        .select('id, escritorio_id, nome, email, papel, admin_escritorio')
        .eq('id', s.user.id)
        .maybeSingle();

      if (!ativo) return;

      if (error) {
        // Erro de verdade (rede, permissão inesperada). Deixa o perfil nulo e
        // marca sem vínculo, para a tela conseguir explicar em vez de piscar.
        setUsuario(null);
        setSemVinculo(true);
      } else if (!data) {
        // Autenticado e sem linha em `usuarios`. Pode ser conta de portal
        // tentando entrar pela área interna, ou usuário desativado — as duas
        // devem parar aqui.
        setUsuario(null);
        setSemVinculo(true);
      } else {
        setUsuario(data as UsuarioLogado);
        setSemVinculo(false);
      }
      setCarregando(false);
    }

    // getSession primeiro para não piscar a tela de login em quem já está
    // logado; onAuthStateChange depois, para acompanhar login, logout e
    // renovação de token.
    supabase.auth.getSession().then(({ data }) => {
      if (!ativo) return;
      setSessao(data.session);
      void carregarPerfil(data.session);
    });

    const { data: inscricao } = supabase.auth.onAuthStateChange((_evento, s) => {
      if (!ativo) return;
      setSessao(s);
      setCarregando(true);
      void carregarPerfil(s);
    });

    return () => {
      ativo = false;
      inscricao.subscription.unsubscribe();
    };
  }, []);

  const valor = useMemo<Contexto>(() => ({
    sessao,
    usuario,
    carregando,
    semVinculo,
    sair: async () => { await supabase.auth.signOut(); },
  }), [sessao, usuario, carregando, semVinculo]);

  return (
    <ContextoSessao.Provider value={valor}>{children}</ContextoSessao.Provider>
  );
}

export function useSessao(): Contexto {
  const c = useContext(ContextoSessao);
  if (!c) throw new Error('useSessao precisa estar dentro de ProvedorDeSessao');
  return c;
}

// Quem pode transformar sugestão em compromisso.
//
// Espelha o trigger `app.confirmacao_e_ato_de_advogado` do banco, e é
// deliberadamente só uma dica de interface: quem decide é o banco, e uma
// requisição montada à mão continua sendo recusada lá. O papel desta função é
// não oferecer um botão que vai falhar — e, mais que isso, poder EXPLICAR por
// que ele não está disponível, que é o que uma caixa desabilitada sem motivo
// não faz.
export function podeConfirmarPrazo(usuario: UsuarioLogado | null): boolean {
  if (!usuario) return false;
  return usuario.papel === 'advogado_responsavel'
      || usuario.papel === 'advogado_associado';
}
