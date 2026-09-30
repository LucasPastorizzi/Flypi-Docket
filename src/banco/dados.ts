// Fonte de dados das telas.
//
// As telas falam com este módulo, e não com o cliente Supabase direto. Isso
// existe por dois motivos, e o segundo é o que importa a longo prazo:
//
//   1. permite o modo demonstração, que mostra a interface sem backend algum;
//   2. mantém num lugar só as consultas que as telas fazem, de modo que uma
//      mudança de coluna apareça aqui e não espalhada por componente.
//
// O modo demonstração NÃO prova nada sobre isolamento. Ele serve para ver
// layout e fluxo. O recorte por papel que ele simula é uma imitação do que as
// policies fazem de verdade — quem prova isso é a suíte pgTAP, contra o banco.
import { supabase } from './cliente';
import { MODO_DEMO, dadosDemo, usuarioDemoAtual } from './demonstracao';
import type { PrazoDaFila, Processo } from './tipos';

export async function listarPrazosSugeridos(): Promise<{
  dados: PrazoDaFila[]; erro: string | null;
}> {
  if (MODO_DEMO) return { dados: dadosDemo.prazosSugeridos(), erro: null };

  // Sem filtro por escritório e sem filtro por papel: quem recorta é a
  // policy. O filtro por status é o que define a fila.
  const { data, error } = await supabase
    .from('prazos')
    .select(`
      id, processo_id, status, contagem, dias, em_dobro, fundamento_dobro,
      data_termo_inicial, data_inicio_contagem, data_vencimento_sugerida,
      data_vencimento_confirmada, fundamento_legal, observacao,
      memoria_calculo, responsavel_id, criado_em,
      processos ( numero_cnj, numero_pasta, tribunal )
    `)
    .eq('status', 'sugerido')
    .order('data_vencimento_sugerida', { ascending: true, nullsFirst: false });

  if (error) return { dados: [], erro: error.message };
  return { dados: (data ?? []) as unknown as PrazoDaFila[], erro: null };
}

export async function confirmarPrazo(
  prazoId: string,
  dataFinal: string,
  dataSugerida: string | null,
  usuarioId: string,
): Promise<{ status: 'confirmado' | 'ajustado'; erro: string | null }> {
  // 'confirmado' quando a data sugerida foi aceita como está; 'ajustado'
  // quando o advogado corrigiu. A distinção alimenta a comparação que revela
  // regra de prazo errada, e por isso não é cosmética.
  const status = dataFinal === dataSugerida ? 'confirmado' : 'ajustado';

  if (MODO_DEMO) {
    dadosDemo.confirmar(prazoId);
    return { status, erro: null };
  }

  const { error } = await supabase
    .from('prazos')
    .update({
      status,
      // O banco exige que seja quem está logado; outro id é recusado pelo
      // trigger. Mandamos o próprio para a trilha apontar a pessoa certa.
      confirmado_por: usuarioId,
      confirmado_em: new Date().toISOString(),
      data_vencimento_confirmada: dataFinal,
    })
    .eq('id', prazoId);

  return { status, erro: error?.message ?? null };
}

export async function listarProcessos(): Promise<{
  dados: Processo[]; erro: string | null;
}> {
  if (MODO_DEMO) return { dados: dadosDemo.processos(usuarioDemoAtual()), erro: null };

  const { data, error } = await supabase
    .from('processos')
    .select(`id, numero_cnj, numero_pasta, tribunal, comarca, situacao,
             segredo_justica, valor_causa, advogado_responsavel_id`)
    .order('criado_em', { ascending: false });

  if (error) return { dados: [], erro: error.message };
  return { dados: (data ?? []) as Processo[], erro: null };
}
