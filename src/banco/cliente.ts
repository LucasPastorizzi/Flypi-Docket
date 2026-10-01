import { createClient } from '@supabase/supabase-js';

// A URL e a anon key vêm do ambiente em tempo de build. Tudo que começa com
// VITE_ é EMBUTIDO no bundle, então nada que seja segredo pode passar por
// aqui — e é por isso que a service_role key não tem variável neste arquivo
// nem em nenhum outro do cliente. Ela passa por cima de todo o RLS; o lugar
// dela é a Edge Function.
const url = import.meta.env.VITE_SUPABASE_URL;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Falha alta e cedo, com instrução. A alternativa — deixar o cliente subir com
// string vazia — produz erro de rede genérico em toda tela, e quem estiver
// configurando o projeto vai procurar o defeito no lugar errado.
if (!url || !anon) {
  throw new Error(
    'Faltam VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY. Copie .env.example ' +
    'para .env.local e preencha com os valores de Project Settings -> API.'
  );
}

export const supabase = createClient(url, anon, {
  auth: {
    // Mantém a sessão entre recarregamentos e renova o token sozinho. Sem
    // isso, o advogado perderia a sessão no meio do trabalho a cada hora.
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
