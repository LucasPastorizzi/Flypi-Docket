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

// --- entidades das telas de cadastro ---------------------------------------

export type TipoPessoa = 'fisica' | 'juridica';
export type Polo = 'ativo' | 'passivo' | 'terceiro';
export type StatusTarefa = 'aberta' | 'em_andamento' | 'concluida' | 'cancelada';
export type EfeitoFeriado = 'dia_nao_util' | 'suspende_prazo';
export type Abrangencia = 'nacional' | 'estadual' | 'municipal' | 'tribunal';

export interface Cliente {
  id: string;
  tipo_pessoa: TipoPessoa;
  nome: string;
  nome_social: string | null;
  documento: string | null;
  email: string | null;
  telefone: string | null;
  cep: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  municipio: string | null;
  uf: string | null;
  observacoes: string | null;
}

export interface Parte {
  id: string;
  processo_id: string;
  polo: Polo;
  qualificacao: string;
  nome: string;
  documento: string | null;
  cliente_id: string | null;
}

export interface Tarefa {
  id: string;
  processo_id: string | null;
  prazo_id: string | null;
  titulo: string;
  descricao: string | null;
  responsavel_id: string | null;
  status: StatusTarefa;
  data_limite: string | null;
  concluida_em: string | null;
}

export interface MembroEquipe {
  id: string;
  processo_id: string;
  usuario_id: string;
  incluido_em: string;
  usuarios: { nome: string; papel: PapelUsuario } | null;
}

export interface Tribunal {
  sigla: string;
  nome: string;
  segmento: string;
  uf: string | null;
}

export interface FeriadoEscritorio {
  id: string;
  abrangencia: Abrangencia;
  uf: string | null;
  municipio: string | null;
  tribunal: string | null;
  data_inicio: string;
  data_fim: string;
  efeito: EfeitoFeriado;
  descricao: string;
  fundamento: string;
  fonte_url: string | null;
}

export interface MembroDoEscritorio {
  id: string;
  nome: string;
  email: string;
  papel: PapelUsuario;
  admin_escritorio: boolean;
  ativo: boolean;
}

export interface LinhaAuditoria {
  id: number;
  ator_id: string | null;
  ator_tipo: 'equipe' | 'portal' | 'servico';
  acao: string;
  entidade: string;
  registro_id: string | null;
  processo_id: string | null;
  dados_depois: { resultado?: string; sigiloso?: boolean } | null;
  ip: string | null;
  ocorrido_em: string;
}

export interface Publicacao {
  id: string;
  fonte: string;
  numero_cnj: string | null;
  numero_processo_bruto: string | null;
  data_publicacao: string | null;
  data_divulgacao: string | null;
  status: string;
  processo_id: string | null;
  tipo_ato: string | null;
  erro_ultimo: string | null;
  recebida_em: string;
  payload: unknown;
}

export interface ProcessoDetalhado extends Processo {
  numero_pasta: string | null;
  orgao_julgador: string | null;
  uf: string | null;
  classe: string | null;
  assunto: string | null;
  data_distribuicao: string | null;
  criado_em: string;
}

export const PAPEL_LEGIVEL: Record<PapelUsuario, string> = {
  advogado_responsavel: 'Advogado responsável',
  advogado_associado: 'Advogado associado',
  estagiario: 'Estagiário',
  secretaria: 'Secretaria',
};

export const SITUACAO_LEGIVEL: Record<SituacaoProcesso, string> = {
  ativo: 'Ativo', suspenso: 'Suspenso', arquivado: 'Arquivado',
  baixado: 'Baixado', encerrado: 'Encerrado',
};

export const POLO_LEGIVEL: Record<Polo, string> = {
  ativo: 'Polo ativo', passivo: 'Polo passivo', terceiro: 'Terceiro',
};

export const STATUS_TAREFA_LEGIVEL: Record<StatusTarefa, string> = {
  aberta: 'Aberta', em_andamento: 'Em andamento',
  concluida: 'Concluída', cancelada: 'Cancelada',
};

// Só dígitos, que é como o banco guarda. A máscara é apresentação — o domínio
// documento_fiscal recusa qualquer coisa que não sejam 11 ou 14 dígitos.
export function apenasDigitos(texto: string): string {
  return texto.replace(/\D/g, '');
}

export function formatarDocumento(doc: string | null): string {
  if (!doc) return '—';
  if (doc.length === 11) {
    return `${doc.slice(0, 3)}.${doc.slice(3, 6)}.${doc.slice(6, 9)}-${doc.slice(9)}`;
  }
  if (doc.length === 14) {
    return `${doc.slice(0, 2)}.${doc.slice(2, 5)}.${doc.slice(5, 8)}`
         + `/${doc.slice(8, 12)}-${doc.slice(12)}`;
  }
  return doc;
}

// NNNNNNN-DD.AAAA.J.TR.OOOO (Res. CNJ 65/2008). O banco guarda os 20 dígitos
// sem pontuação, para casar com o que a API do CNJ devolve sem normalizar dos
// dois lados a cada consulta.
export function formatarCnj(numero: string | null): string {
  if (!numero || numero.length !== 20) return numero ?? '—';
  return `${numero.slice(0, 7)}-${numero.slice(7, 9)}.${numero.slice(9, 13)}`
       + `.${numero.slice(13, 14)}.${numero.slice(14, 16)}.${numero.slice(16)}`;
}

export function formatarInstante(instante: string | null): string {
  if (!instante) return '—';
  return new Date(instante).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}
