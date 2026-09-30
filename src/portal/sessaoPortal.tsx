import {
  createContext, useContext, useEffect, useMemo, useState, type ReactNode,
} from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../banco/cliente';
import { obterPerfilDoPortal } from '../banco/dados';

interface ClientePortal {
  id: string; escritorio_id: string; cliente_id: string;
  nome: string; email: string;
}

interface Contexto {
  sessao: Session | null;
  cliente: ClientePortal | null;
  carregando: boolean;
  // Autenticado, mas não é cliente de portal. O caso que interessa: alguém da
  // equipe entrando pela URL do portal. Precisa de mensagem própria, senão a
  // pessoa vê "nenhum processo" e conclui que o sistema perdeu os dados dela.
  naoEhCliente: boolean;
  sair: () => Promise<void>;
}

const ContextoPortal = createContext<Contexto | null>(null);

export function ProvedorDoPortal({ children }: { children: ReactNode }) {
  const [sessao, setSessao] = useState<Session | null>(null);
  const [cliente, setCliente] = useState<ClientePortal | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [naoEhCliente, setNaoEhCliente] = useState(false);

  useEffect(() => {
    let ativo = true;

    async function carregar(s: Session | null) {
      if (!s) {
        setCliente(null); setNaoEhCliente(false); setCarregando(false);
        return;
      }
      const { dados } = await obterPerfilDoPortal(s.user.id);
      if (!ativo) return;
      setCliente(dados);
      setNaoEhCliente(!dados);
      setCarregando(false);
    }

    supabase.auth.getSession().then(({ data }) => {
      if (!ativo) return;
      setSessao(data.session);
      void carregar(data.session);
    });

    const { data: inscricao } = supabase.auth.onAuthStateChange((_e, s) => {
      if (!ativo) return;
      setSessao(s); setCarregando(true); void carregar(s);
    });

    return () => { ativo = false; inscricao.subscription.unsubscribe(); };
  }, []);

  const valor = useMemo<Contexto>(() => ({
    sessao, cliente, carregando, naoEhCliente,
    sair: async () => { await supabase.auth.signOut(); },
  }), [sessao, cliente, carregando, naoEhCliente]);

  return (
    <ContextoPortal.Provider value={valor}>{children}</ContextoPortal.Provider>
  );
}

export function usePortal(): Contexto {
  const c = useContext(ContextoPortal);
  if (!c) throw new Error('usePortal precisa estar dentro de ProvedorDoPortal');
  return c;
}
