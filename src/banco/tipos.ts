// Tipos das linhas que as telas consomem.
//
// Escritos à mão por enquanto, e de propósito: `supabase gen types` gera o
// schema inteiro — 21 tabelas, todos os enums — e ainda exige o projeto
// linkado. O que está aqui é só o que as telas leem, o que mantém o
// acoplamento visível: quando uma coluna mudar de nome, o erro aparece aqui e
// não espalhado por dez componentes.
//
// Quando o projeto estiver linkado, `npm run tipos` gera o arquivo completo e
// estes tipos passam a derivar dele.

export type PapelUsuario =
  | 'advogado_responsavel'
  | 'advogado_associado'
  | 'estagiario'
  | 'secretaria';

export type StatusPrazo =
  | 'sugerido'
  | 'confirmado'
  | 'ajustado'
  | 'cumprido'
  | 'perdido'
  | 'cancelado';

export type TipoContagem = 'dias_uteis' | 'dias_corridos';

export type SituacaoProcesso =
  | 'ativo' | 'suspenso' | 'arquivado' | 'baixado' | 'encerrado';

export interface UsuarioLogado {
  id: string;
  escritorio_id: string;
  nome: string;
  email: string;
  papel: PapelUsuario;
  admin_escritorio: boolean;
}

export interface Processo {
  id: string;
  numero_cnj: string | null;
  numero_pasta: string | null;
  tribunal: string | null;
  comarca: string | null;
  situacao: SituacaoProcesso;
  segredo_justica: boolean;
  valor_causa: string | null;
  advogado_responsavel_id: string | null;
}

export interface PrazoDaFila {
  id: string;
  processo_id: string;
  status: StatusPrazo;
  contagem: TipoContagem | null;
  dias: number | null;
  em_dobro: boolean;
  fundamento_dobro: string | null;
  data_termo_inicial: string | null;
  data_inicio_contagem: string | null;
  data_vencimento_sugerida: string | null;
  data_vencimento_confirmada: string | null;
  fundamento_legal: string | null;
  observacao: string | null;
  memoria_calculo: unknown;
  responsavel_id: string | null;
  criado_em: string;
  // Vem do join declarado no select. O PostgREST devolve objeto quando a
  // relação é para um, e a coluna é nullable no schema, então pode vir nulo.
  processos: Pick<Processo, 'numero_cnj' | 'numero_pasta' | 'tribunal'> | null;
}

// `numeric` chega como string no JSON, não como number, e isso é correto:
// converter para double no transporte é justamente o que o briefing proíbe
// ao exigir numeric no banco. Valor monetário é formatado a partir da string.
export function formatarDinheiro(valor: string | null): string {
  if (valor === null) return '—';
  const n = Number(valor);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// `date` do Postgres chega como 'AAAA-MM-DD'. Formatar com `new Date(texto)`
// interpretaria como UTC e mostraria o dia anterior em fuso negativo — que é
// o Brasil inteiro. Em data de vencimento de prazo, um dia de erro é a
// diferença entre tempestivo e intempestivo, então a conversão é manual.
export function formatarData(data: string | null): string {
  if (!data) return '—';
  const partes = data.split('-');
  const ano = partes[0], mes = partes[1], dia = partes[2];
  if (!ano || !mes || !dia) return '—';
  return `${dia}/${mes}/${ano}`;
}

// Dias corridos até a data, na hora local. Usado só para destacar urgência na
// lista — NÃO é contagem de prazo processual, que é dias úteis com feriado por
// tribunal e mora no banco. Confundir os dois aqui seria reintroduzir no front
// exactly a regra que o briefing manda não inventar.
export function diasCorridosAte(data: string | null): number | null {
  if (!data) return null;
  const partes = data.split('-').map(Number);
  const ano = partes[0], mes = partes[1], dia = partes[2];
  if (ano === undefined || mes === undefined || dia === undefined) return null;
  const alvo = new Date(ano, mes - 1, dia);
  const hoje = new Date();
  const hojeSemHora = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
  return Math.round((alvo.getTime() - hojeSemHora.getTime()) / 86_400_000);
}
