// Fonte de dados das telas.
//
// As telas falam com este módulo, e não com o cliente Supabase direto, para
// que as consultas fiquem num lugar só: uma coluna renomeada aparece aqui em
// vez de espalhada por dez componentes.
//
// Nenhuma função abaixo filtra por escritório ou por papel. Quem recorta é a
// policy, no banco. Repetir o recorte aqui criaria uma segunda regra para
// divergir da primeira — e a cópia do cliente é a que ninguém testa.
import { supabase } from './cliente';
import type {
  Cliente, FeriadoEscritorio, LinhaAuditoria, MembroDoEscritorio, MembroEquipe,
  Parte, PrazoDaFila, Processo, ProcessoDetalhado, Publicacao, Tarefa,
  Tribunal,
} from './tipos';

export async function listarPrazosSugeridos(): Promise<{
  dados: PrazoDaFila[]; erro: string | null;
}> {
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
  const { data, error } = await supabase
    .from('processos')
    .select(`id, numero_cnj, numero_pasta, tribunal, comarca, situacao,
             segredo_justica, valor_causa, advogado_responsavel_id`)
    .order('criado_em', { ascending: false });

  if (error) return { dados: [], erro: error.message };
  return { dados: (data ?? []) as Processo[], erro: null };
}

// ---------------------------------------------------------------------------
// Processos
// ---------------------------------------------------------------------------

const COLUNAS_PROCESSO = `id, numero_cnj, numero_pasta, tribunal, orgao_julgador,
  comarca, uf, classe, assunto, situacao, segredo_justica, valor_causa,
  data_distribuicao, advogado_responsavel_id, criado_em`;

export async function obterProcesso(id: string) {
  const { data, error } = await supabase
    .from('processos').select(COLUNAS_PROCESSO).eq('id', id).maybeSingle();
  return { dados: data as ProcessoDetalhado | null, erro: error?.message ?? null };
}

// Leitura auditada — o único caminho para processo em segredo de justiça.
//
// O SELECT direto não devolve processo sigiloso para ninguém: as policies o
// excluem, porque o Postgres não tem trigger de SELECT e o registro de acesso
// precisa ser garantia e não boa intenção. Esta RPC grava quem acessou, quando
// e se foi permitido, e só então devolve a linha.
export async function verProcessoComRegistro(id: string) {
  const { data, error } = await supabase.rpc('ver_processo', { p_processo: id });
  const linha = Array.isArray(data) ? data[0] : null;
  return {
    dados: (linha ?? null) as ProcessoDetalhado | null,
    erro: error?.message ?? null,
  };
}

export async function salvarProcesso(
  processo: Partial<ProcessoDetalhado> & { escritorio_id?: string },
  id?: string,
) {
  const q = id
    ? supabase.from('processos').update(processo).eq('id', id).select().single()
    : supabase.from('processos').insert(processo).select().single();
  const { data, error } = await q;
  return { dados: data as ProcessoDetalhado | null, erro: error?.message ?? null };
}

// ---------------------------------------------------------------------------
// Partes, equipe
// ---------------------------------------------------------------------------

export async function listarPartes(processoId: string) {
  const { data, error } = await supabase
    .from('partes')
    .select('id, processo_id, polo, qualificacao, nome, documento, cliente_id')
    .eq('processo_id', processoId)
    .order('polo');
  return { dados: (data ?? []) as Parte[], erro: error?.message ?? null };
}

export async function salvarParte(parte: Partial<Parte> & { escritorio_id: string }) {
  const { error } = await supabase.from('partes').insert(parte);
  return { erro: error?.message ?? null };
}

export async function removerParte(id: string) {
  // Exclusão lógica: a policy autoriza UPDATE, e DELETE não é concedido a
  // ninguém no schema. Parte removida por engano continua recuperável.
  const { error } = await supabase
    .from('partes').update({ excluido_em: new Date().toISOString() }).eq('id', id);
  return { erro: error?.message ?? null };
}

export async function listarEquipe(processoId: string) {
  const { data, error } = await supabase
    .from('processos_equipe')
    // A FK é nomeada porque processos_equipe tem TRÊS caminhos até `usuarios`
    // — quem trabalha no caso, quem incluiu e quem retirou. Sem dizer qual, o
    // PostgREST recusa a consulta por ambiguidade em vez de escolher uma.
    .select(`id, processo_id, usuario_id, incluido_em,
             usuarios!processos_equipe_usuario_id_fkey ( nome, papel )`)
    .eq('processo_id', processoId)
    .is('removido_em', null);
  return {
    dados: (data ?? []) as unknown as MembroEquipe[],
    erro: error?.message ?? null,
  };
}

export async function incluirNaEquipe(
  escritorioId: string, processoId: string, usuarioId: string, porQuem: string,
) {
  const { error } = await supabase.from('processos_equipe').insert({
    escritorio_id: escritorioId, processo_id: processoId,
    usuario_id: usuarioId, incluido_por: porQuem,
  });
  return { erro: error?.message ?? null };
}

export async function removerDaEquipe(id: string, porQuem: string) {
  // Saída registrada, não linha apagada: para saber depois quem tinha acesso
  // ao processo na data em que algo aconteceu.
  const { error } = await supabase.from('processos_equipe')
    .update({ removido_em: new Date().toISOString(), removido_por: porQuem })
    .eq('id', id);
  return { erro: error?.message ?? null };
}

// ---------------------------------------------------------------------------
// Clientes
// ---------------------------------------------------------------------------

const COLUNAS_CLIENTE = `id, tipo_pessoa, nome, nome_social, documento, email,
  telefone, cep, logradouro, numero, complemento, bairro, municipio, uf,
  observacoes`;

export async function listarClientes() {
  const { data, error } = await supabase
    .from('clientes').select(COLUNAS_CLIENTE).order('nome');
  return { dados: (data ?? []) as Cliente[], erro: error?.message ?? null };
}

export async function obterCliente(id: string) {
  const { data, error } = await supabase
    .from('clientes').select(COLUNAS_CLIENTE).eq('id', id).maybeSingle();
  return { dados: data as Cliente | null, erro: error?.message ?? null };
}

export async function salvarCliente(
  cliente: Partial<Cliente> & { escritorio_id?: string }, id?: string,
) {
  const q = id
    ? supabase.from('clientes').update(cliente).eq('id', id).select().single()
    : supabase.from('clientes').insert(cliente).select().single();
  const { data, error } = await q;
  return { dados: data as Cliente | null, erro: error?.message ?? null };
}

// ---------------------------------------------------------------------------
// Tarefas
// ---------------------------------------------------------------------------

const COLUNAS_TAREFA = `id, processo_id, prazo_id, titulo, descricao,
  responsavel_id, status, data_limite, concluida_em`;

export async function listarTarefas(processoId?: string) {
  const base = supabase.from('tarefas').select(COLUNAS_TAREFA)
    .order('data_limite', { ascending: true, nullsFirst: false });
  const { data, error } = processoId
    ? await base.eq('processo_id', processoId)
    : await base;
  return { dados: (data ?? []) as Tarefa[], erro: error?.message ?? null };
}

export async function salvarTarefa(
  tarefa: Partial<Tarefa> & { escritorio_id?: string }, id?: string,
) {
  const q = id
    ? supabase.from('tarefas').update(tarefa).eq('id', id)
    : supabase.from('tarefas').insert(tarefa);
  const { error } = await q;
  return { erro: error?.message ?? null };
}

export async function concluirTarefa(id: string, porQuem: string) {
  const { error } = await supabase.from('tarefas').update({
    status: 'concluida',
    concluida_em: new Date().toISOString(),
    concluida_por: porQuem,
  }).eq('id', id);
  return { erro: error?.message ?? null };
}

// ---------------------------------------------------------------------------
// Prazos do processo
// ---------------------------------------------------------------------------

export async function listarPrazosDoProcesso(processoId: string) {
  const { data, error } = await supabase
    .from('prazos')
    .select(`id, processo_id, status, contagem, dias, em_dobro,
             fundamento_dobro, data_termo_inicial, data_inicio_contagem,
             data_vencimento_sugerida, data_vencimento_confirmada,
             fundamento_legal, observacao, memoria_calculo, responsavel_id,
             criado_em, processos ( numero_cnj, numero_pasta, tribunal )`)
    .eq('processo_id', processoId)
    .order('data_vencimento_confirmada', { ascending: true, nullsFirst: false });
  return {
    dados: (data ?? []) as unknown as PrazoDaFila[],
    erro: error?.message ?? null,
  };
}

export async function lancarPrazoManual(
  prazo: Record<string, unknown>,
) {
  const { error } = await supabase.from('prazos').insert(prazo);
  return { erro: error?.message ?? null };
}

// ---------------------------------------------------------------------------
// Calendário
// ---------------------------------------------------------------------------

export async function listarFeriadosDoEscritorio() {
  const { data, error } = await supabase
    .from('feriados_escritorio')
    .select(`id, abrangencia, uf, municipio, tribunal, data_inicio, data_fim,
             efeito, descricao, fundamento, fonte_url`)
    .order('data_inicio', { ascending: false });
  return {
    dados: (data ?? []) as FeriadoEscritorio[], erro: error?.message ?? null,
  };
}

export async function salvarFeriado(
  feriado: Partial<FeriadoEscritorio> & { escritorio_id?: string },
) {
  const { error } = await supabase.from('feriados_escritorio').insert(feriado);
  return { erro: error?.message ?? null };
}

export async function excluirFeriado(id: string, porQuem: string) {
  const { error } = await supabase.from('feriados_escritorio')
    .update({ excluido_em: new Date().toISOString(), excluido_por: porQuem })
    .eq('id', id);
  return { erro: error?.message ?? null };
}

export async function listarTribunais() {
  const { data, error } = await supabase
    .from('tribunais').select('sigla, nome, segmento, uf').order('sigla');
  return { dados: (data ?? []) as Tribunal[], erro: error?.message ?? null };
}

// ---------------------------------------------------------------------------
// Equipe do escritório
// ---------------------------------------------------------------------------

export async function listarMembrosDoEscritorio() {
  const { data, error } = await supabase
    .from('usuarios')
    .select('id, nome, email, papel, admin_escritorio, ativo')
    .order('nome');
  return {
    dados: (data ?? []) as MembroDoEscritorio[], erro: error?.message ?? null,
  };
}

export async function atualizarMembro(
  id: string, mudanca: Partial<MembroDoEscritorio>,
) {
  const { error } = await supabase.from('usuarios').update(mudanca).eq('id', id);
  return { erro: error?.message ?? null };
}

// ---------------------------------------------------------------------------
// Auditoria e publicações
// ---------------------------------------------------------------------------

export async function listarAuditoria(processoId?: string) {
  const base = supabase.from('auditoria')
    .select(`id, ator_id, ator_tipo, acao, entidade, registro_id, processo_id,
             dados_depois, ip, ocorrido_em`)
    .order('ocorrido_em', { ascending: false })
    .limit(200);
  const { data, error } = processoId
    ? await base.eq('processo_id', processoId)
    : await base;
  return { dados: (data ?? []) as LinhaAuditoria[], erro: error?.message ?? null };
}

export async function listarPublicacoes() {
  const { data, error } = await supabase
    .from('publicacoes')
    .select(`id, fonte, numero_cnj, numero_processo_bruto, data_publicacao,
             data_divulgacao, status, processo_id, tipo_ato, erro_ultimo,
             recebida_em, payload`)
    .order('recebida_em', { ascending: false })
    .limit(100);
  return { dados: (data ?? []) as Publicacao[], erro: error?.message ?? null };
}
