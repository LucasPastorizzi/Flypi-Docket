// Modo demonstração: a interface com dados fictícios, sem backend algum.
//
// ---------------------------------------------------------------------------
// TRAVA DE SEGURANÇA
//
// `import.meta.env.DEV` é false em qualquer build de produção, e o Vite remove
// por dead-code elimination tudo que depende dele. Ou seja: este modo é
// IMPOSSÍVEL de ativar num build publicado, mesmo que alguém defina a variável
// de ambiente por engano no servidor de build.
//
// A trava está aqui e não numa convenção porque o risco é real e silencioso:
// uma tela de login que aceita qualquer pessoa, publicada sem querer, num
// produto que guarda processo sob segredo de justiça.
// ---------------------------------------------------------------------------
//
// O QUE ESTE MODO NÃO É: prova de nada. O recorte por papel abaixo é uma
// IMITAÇÃO do que as policies fazem — escrita à mão, em JavaScript, no
// navegador. Quem prova isolamento é a suíte pgTAP contra o banco, com 112
// asserções. Se algum dia as duas divergirem, a errada é esta.

import type { PapelUsuario, PrazoDaFila, Processo, UsuarioLogado } from './tipos';

export const MODO_DEMO =
  import.meta.env.DEV && import.meta.env.VITE_MODO_DEMO === 'true';

// As contas de demonstração. Não há senha: em modo demonstração o login é uma
// escolha de perfil, porque o objetivo é ver a interface sob cada papel — e
// inventar uma senha só acrescentaria um passo sem acrescentar nada.
export const CONTAS_DEMO: ReadonlyArray<UsuarioLogado & { descricao: string }> = [
  {
    id: 'demo-resp', escritorio_id: 'demo-escritorio',
    nome: 'Dra. Helena Rocha', email: 'helena@demonstracao.local',
    papel: 'advogado_responsavel', admin_escritorio: true,
    descricao: 'Vê todos os processos do escritório e confirma prazo.',
  },
  {
    id: 'demo-assoc', escritorio_id: 'demo-escritorio',
    nome: 'Dr. Tiago Menezes', email: 'tiago@demonstracao.local',
    papel: 'advogado_associado', admin_escritorio: false,
    descricao: 'Vê só os processos em que foi incluído na equipe. Confirma prazo.',
  },
  {
    id: 'demo-sec', escritorio_id: 'demo-escritorio',
    nome: 'Marina Kruger', email: 'marina@demonstracao.local',
    papel: 'secretaria', admin_escritorio: false,
    descricao: 'Vê o escritório todo para cadastrar, mas NÃO confirma prazo.',
  },
];

const CHAVE_SESSAO = 'flypi-demo-usuario';

export function usuarioDemoAtual(): UsuarioLogado | null {
  if (!MODO_DEMO) return null;
  try {
    const id = sessionStorage.getItem(CHAVE_SESSAO);
    return CONTAS_DEMO.find((c) => c.id === id) ?? null;
  } catch {
    // sessionStorage pode lançar em janela privada ou com storage bloqueado.
    return null;
  }
}

export function entrarComoDemo(id: string): void {
  try { sessionStorage.setItem(CHAVE_SESSAO, id); } catch { /* sem sessão */ }
}

export function sairDoDemo(): void {
  try { sessionStorage.removeItem(CHAVE_SESSAO); } catch { /* nada a fazer */ }
}

// --- dado fictício -----------------------------------------------------------

// Datas relativas a hoje, para a fila nunca aparecer toda vencida.
function emDias(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mes}-${dia}`;
}

const PROCESSOS: ReadonlyArray<Processo & { equipe: string[] }> = [
  {
    id: 'p1', numero_cnj: '50012345620268210001', numero_pasta: '2026/014',
    tribunal: 'TJRS', comarca: 'Novo Hamburgo', situacao: 'ativo',
    segredo_justica: false, valor_causa: '48500.00',
    advogado_responsavel_id: 'demo-resp', equipe: ['demo-assoc'],
  },
  {
    id: 'p2', numero_cnj: '50098765420268210027', numero_pasta: '2026/021',
    tribunal: 'TJRS', comarca: 'Porto Alegre', situacao: 'ativo',
    segredo_justica: false, valor_causa: '132000.00',
    advogado_responsavel_id: 'demo-resp', equipe: [],
  },
  {
    id: 'p3', numero_cnj: '00211234520265040331', numero_pasta: '2026/009',
    tribunal: 'TRT4', comarca: 'Sapiranga', situacao: 'suspenso',
    segredo_justica: false, valor_causa: '27300.50',
    advogado_responsavel_id: 'demo-resp', equipe: ['demo-assoc'],
  },
  {
    id: 'p4', numero_cnj: '50044455620268210044', numero_pasta: '2026/030',
    tribunal: 'TJRS', comarca: 'Ivoti', situacao: 'ativo',
    // Sigiloso: NÃO aparece em lista nenhuma, para nenhum papel. No sistema de
    // verdade a leitura dele passa pela RPC que registra o acesso, e esta
    // demonstração reproduz a ausência para que a tela não crie o hábito de
    // esperar que ele esteja ali.
    segredo_justica: true, valor_causa: '90000.00',
    advogado_responsavel_id: 'demo-resp', equipe: [],
  },
];

interface PrazoDemo extends PrazoDaFila { confirmado: boolean }

const PRAZOS: PrazoDemo[] = [
  {
    id: 'z1', processo_id: 'p1', status: 'sugerido', contagem: 'dias_uteis',
    dias: 15, em_dobro: false, fundamento_dobro: null,
    data_termo_inicial: emDias(-2), data_inicio_contagem: emDias(-1),
    data_vencimento_sugerida: emDias(2), data_vencimento_confirmada: null,
    // Nenhuma regra processual é afirmada aqui. O texto diz o que o dado é.
    fundamento_legal: 'Dado de demonstração — não é orientação jurídica',
    observacao: null, memoria_calculo: null, responsavel_id: 'demo-resp',
    criado_em: new Date().toISOString(), confirmado: false,
    processos: { numero_cnj: '50012345620268210001', numero_pasta: '2026/014',
                 tribunal: 'TJRS' },
  },
  {
    id: 'z2', processo_id: 'p2', status: 'sugerido', contagem: 'dias_uteis',
    dias: 15, em_dobro: true,
    fundamento_dobro: 'Litisconsortes com procuradores distintos (demonstração)',
    data_termo_inicial: emDias(-1), data_inicio_contagem: emDias(0),
    data_vencimento_sugerida: emDias(21), data_vencimento_confirmada: null,
    fundamento_legal: 'Dado de demonstração — não é orientação jurídica',
    observacao: null, memoria_calculo: null, responsavel_id: 'demo-resp',
    criado_em: new Date().toISOString(), confirmado: false,
    processos: { numero_cnj: '50098765420268210027', numero_pasta: '2026/021',
                 tribunal: 'TJRS' },
  },
  {
    id: 'z3', processo_id: 'p3', status: 'sugerido', contagem: 'dias_corridos',
    dias: 5, em_dobro: false, fundamento_dobro: null,
    data_termo_inicial: emDias(-4), data_inicio_contagem: emDias(-3),
    data_vencimento_sugerida: emDias(1), data_vencimento_confirmada: null,
    fundamento_legal: 'Dado de demonstração — não é orientação jurídica',
    observacao: null, memoria_calculo: null, responsavel_id: 'demo-assoc',
    criado_em: new Date().toISOString(), confirmado: false,
    processos: { numero_cnj: '00211234520265040331', numero_pasta: '2026/009',
                 tribunal: 'TRT4' },
  },
];

function enxergaTudo(papel: PapelUsuario): boolean {
  return papel === 'advogado_responsavel' || papel === 'secretaria';
}

export const dadosDemo = {
  prazosSugeridos(): PrazoDaFila[] {
    return PRAZOS.filter((p) => !p.confirmado);
  },

  confirmar(id: string): void {
    const p = PRAZOS.find((x) => x.id === id);
    if (p) p.confirmado = true;
  },

  // Imitação do recorte que as policies fazem. Sigiloso fora para todos;
  // associado só vê onde está na equipe ou é o responsável.
  processos(usuario: UsuarioLogado | null): Processo[] {
    if (!usuario) return [];
    return PROCESSOS
      .filter((p) => !p.segredo_justica)
      .filter((p) =>
        enxergaTudo(usuario.papel)
        || p.advogado_responsavel_id === usuario.id
        || p.equipe.includes(usuario.id))
      .map(({ equipe: _equipe, ...resto }) => resto);
  },
};
