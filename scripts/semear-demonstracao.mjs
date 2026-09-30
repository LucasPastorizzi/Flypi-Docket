// ============================================================================
// Semeia um escritório de demonstração no projeto Supabase linkado
// ============================================================================
//
// NÃO É PARA RODAR EM BASE COM DADO REAL. Cria um escritório fictício, com
// pessoas fictícias, para que as telas tenham conteúdo enquanto o produto está
// sendo construído.
//
// Sobre a chave: a escrita precisa passar por cima do RLS — é justamente o
// papel da service_role — e a chave é obtida do CLI que você já autorizou, no
// momento da execução. Ela fica em memória, não é impressa, não é gravada e
// não entra no repositório. É a mesma relação de confiança do `supabase db
// push`, que também usa suas credenciais sem expô-las.
//
// As senhas das contas de demonstração são SORTEADAS a cada execução e
// gravadas em `.credenciais-demo.local`, que está no .gitignore. Não ficam no
// código: este repositório é público, e as contas existem de verdade no
// projeto.
//
// O QUE ESTE SCRIPT NÃO FAZ, e é deliberado: não cadastra regra de prazo nem
// feriado. Os prazos abaixo entram como lançamento manual, com o fundamento
// dizendo que são demonstração. Inventar "15 dias úteis do art. tal" para a
// tela ficar convincente seria plantar no banco exatamente a regra que a
// equipe não tem competência para afirmar — e que, uma vez semeada, alguém
// mais adiante trataria como revisada.
//
// Uso:  node scripts/semear-demonstracao.mjs

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';

const REF = 'brzfxdafylebdqdngtwg';
const URL_BASE = `https://${REF}.supabase.co`;

function chaveDeServico() {
  const saida = execFileSync(
    'supabase',
    ['projects', 'api-keys', '--project-ref', REF, '--output', 'json'],
    { encoding: 'utf8' },
  );
  const chave = JSON.parse(saida)
    .find((k) => k.name === 'service_role')?.api_key;
  if (!chave) {
    throw new Error(
      'não encontrei a service_role key. Rode `supabase login` e tente de novo.'
    );
  }
  return chave;
}

const CHAVE = chaveDeServico();

async function api(caminho, metodo, corpo, prefer) {
  const cabecalhos = {
    apikey: CHAVE,
    Authorization: `Bearer ${CHAVE}`,
    'Content-Type': 'application/json',
  };
  if (prefer) cabecalhos.Prefer = prefer;
  const r = await fetch(`${URL_BASE}${caminho}`, {
    method: metodo,
    headers: cabecalhos,
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const texto = await r.text();
  const dados = texto ? JSON.parse(texto) : null;
  if (r.status >= 300) {
    // A mensagem do Postgres vem inteira de propósito: quase todo erro aqui é
    // uma constraint ou um trigger do schema recusando dado incoerente, e a
    // mensagem diz exatamente qual invariante foi violada.
    throw new Error(`${metodo} ${caminho} -> ${r.status}: ${JSON.stringify(dados)}`);
  }
  return dados;
}

// O PostgREST exige que todos os objetos de um lote tenham exatamente as
// mesmas chaves — ele monta um único INSERT com uma lista de colunas fixa.
//
// A primeira versão disto completava com null as chaves que faltassem, e a
// conveniência saiu cara na hora: `segredo_justica` é NOT NULL com default
// false, e preencher com null derruba o default e viola a constraint. Pior
// seria se tivesse funcionado — um default de segurança substituído por null
// em silêncio é o tipo de coisa que não dá erro nenhum e vira problema depois.
//
// Então aqui não se completa nada: quem escreve o lote declara todas as
// colunas em todas as linhas, e a divergência é apontada com os nomes.
function conferirChaves(tabela, linhas) {
  const chaves = [...new Set(linhas.flatMap((l) => Object.keys(l)))];
  for (const [i, linha] of linhas.entries()) {
    const faltando = chaves.filter((k) => !(k in linha));
    if (faltando.length > 0) {
      throw new Error(
        `lote de ${tabela}: a linha ${i} não declara ${faltando.join(', ')}. `
        + 'Declare a coluna explicitamente — com o valor certo, não com null.'
      );
    }
  }
  return linhas;
}

const inserir = (tabela, linhas) =>
  api(`/rest/v1/${tabela}`, 'POST', conferirChaves(tabela, linhas),
      'return=representation');

function senhaSorteada() {
  return randomBytes(12).toString('base64url');
}

// Datas relativas para a fila nunca nascer toda vencida.
function emDias(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

const CONTAS = [
  { chave: 'helena', nome: 'Dra. Helena Rocha', email: 'helena@demonstracao.flypi.local',
    papel: 'advogado_responsavel', admin: true },
  { chave: 'tiago', nome: 'Dr. Tiago Menezes', email: 'tiago@demonstracao.flypi.local',
    papel: 'advogado_associado', admin: false },
  { chave: 'marina', nome: 'Marina Kruger', email: 'marina@demonstracao.flypi.local',
    papel: 'secretaria', admin: false },
];

const RAZAO_SOCIAL = 'Advocacia Demonstração (dado fictício)';

// Apaga o que ESTE script criou, para que ele possa rodar de novo.
//
// Exclusão física, e é a única do sistema: o resto do produto usa exclusão
// lógica porque processo sob prazo é documento de defesa profissional. Dado de
// demonstração é o oposto disso — existe para ser descartado, e mantê-lo
// "logicamente excluído" só encheria a base de lixo invisível.
//
// A ordem segue as chaves estrangeiras, das folhas para a raiz.
async function limpar() {
  const escritorios = await api(
    `/rest/v1/escritorios?select=id&razao_social=eq.${encodeURIComponent(RAZAO_SOCIAL)}`,
    'GET');
  if (escritorios.length === 0) return false;

  for (const e of escritorios) {
    for (const tabela of [
      'tarefas', 'prazos', 'publicacoes', 'documentos', 'acessos_portal',
      'processos_equipe', 'partes', 'usuarios_portal', 'solicitacoes_titular',
      'feriados_escritorio', 'processos', 'clientes', 'oabs_usuario',
      'auditoria', 'usuarios',
    ]) {
      await api(`/rest/v1/${tabela}?escritorio_id=eq.${e.id}`, 'DELETE');
    }
    await api(`/rest/v1/escritorios?id=eq.${e.id}`, 'DELETE');
  }

  // As contas de autenticação, que não pertencem a nenhuma tabela nossa.
  const lista = await api('/auth/v1/admin/users?per_page=200', 'GET');
  for (const u of lista.users ?? []) {
    if (CONTAS.some((c) => c.email === u.email)) {
      await api(`/auth/v1/admin/users/${u.id}`, 'DELETE');
    }
  }
  return true;
}

async function main() {
  console.log('Semeando escritório de demonstração…\n');

  if (await limpar()) {
    console.log('  (demonstração anterior removida)');
  }

  // --- contas de autenticação ---
  const credenciais = [];
  for (const conta of CONTAS) {
    conta.senha = senhaSorteada();
    const criada = await api('/auth/v1/admin/users', 'POST', {
      email: conta.email,
      password: conta.senha,
      email_confirm: true,  // evita depender de caixa de e-mail
    });
    conta.id = criada.id;
    credenciais.push(`${conta.papel.padEnd(22)} ${conta.email}  ${conta.senha}`);
    console.log(`  conta criada: ${conta.nome}`);
  }

  // --- escritório ---
  const [escritorio] = await inserir('escritorios', [{
    razao_social: 'Advocacia Demonstração (dado fictício)',
    nome_fantasia: 'Demonstração',
    uf_principal: 'RS',
  }]);
  console.log('  escritório criado');

  await inserir('usuarios', CONTAS.map((c) => ({
    id: c.id, escritorio_id: escritorio.id, nome: c.nome, email: c.email,
    papel: c.papel, admin_escritorio: c.admin,
  })));

  const helena = CONTAS[0], tiago = CONTAS[1];

  await inserir('oabs_usuario', [
    { escritorio_id: escritorio.id, usuario_id: helena.id,
      numero: '104777', seccional: 'RS' },
    // Segunda seccional do mesmo advogado: o caso que o briefing cita e que
    // motiva a tabela existir.
    { escritorio_id: escritorio.id, usuario_id: helena.id,
      numero: '58921', seccional: 'SC' },
  ]);

  // --- catálogo global de tribunais (não é dado do escritório) ---
  await api('/rest/v1/tribunais', 'POST', [
    { sigla: 'TJRS', nome: 'Tribunal de Justiça do Rio Grande do Sul',
      segmento: 'estadual', uf: 'RS' },
    { sigla: 'TRT4', nome: 'Tribunal Regional do Trabalho da 4ª Região',
      segmento: 'trabalho', uf: 'RS' },
  ], 'resolution=merge-duplicates');
  console.log('  tribunais cadastrados');

  // --- clientes ---
  const clientes = await inserir('clientes', [
    { escritorio_id: escritorio.id, tipo_pessoa: 'fisica',
      nome: 'Joana Beltrame (fictícia)', documento: '11144477735',
      municipio: 'Ivoti', uf: 'RS', criado_por: helena.id },
    { escritorio_id: escritorio.id, tipo_pessoa: 'juridica',
      nome: 'Metalúrgica Vale Verde Ltda (fictícia)',
      documento: '11222333000181', municipio: 'Novo Hamburgo', uf: 'RS',
      criado_por: helena.id },
  ]);

  // --- processos ---
  const processos = await inserir('processos', [
    { escritorio_id: escritorio.id, numero_cnj: '50012345620268210001',
      numero_pasta: '2026/014', tribunal: 'TJRS', comarca: 'Novo Hamburgo',
      uf: 'RS', classe: 'Procedimento Comum Cível', situacao: 'ativo',
      segredo_justica: false, valor_causa: '48500.00', advogado_responsavel_id: helena.id,
      criado_por: helena.id },
    { escritorio_id: escritorio.id, numero_cnj: '50098765420268210027',
      numero_pasta: '2026/021', tribunal: 'TJRS', comarca: 'Porto Alegre',
      uf: 'RS', classe: 'Execução de Título Extrajudicial', situacao: 'ativo',
      segredo_justica: false, valor_causa: '132000.00', advogado_responsavel_id: helena.id,
      criado_por: helena.id },
    { escritorio_id: escritorio.id, numero_cnj: '00211234520265040331',
      numero_pasta: '2026/009', tribunal: 'TRT4', comarca: 'Sapiranga',
      uf: 'RS', classe: 'Reclamação Trabalhista', situacao: 'ativo',
      segredo_justica: false, valor_causa: '27300.50', advogado_responsavel_id: helena.id,
      criado_por: helena.id },
    // Sigiloso: não aparece em SELECT para ninguém. A leitura passa pela RPC
    // que registra o acesso — é o critério de aceite do briefing, e este
    // processo existe para que dê para comprovar isso na tela.
    { escritorio_id: escritorio.id, numero_cnj: '50044455620268210044',
      numero_pasta: '2026/030', tribunal: 'TJRS', comarca: 'Ivoti', uf: 'RS',
      classe: 'Ação de Família', situacao: 'ativo', segredo_justica: true,
      valor_causa: '90000.00', advogado_responsavel_id: helena.id,
      criado_por: helena.id },
  ]);
  console.log(`  ${processos.length} processos criados (1 em segredo de justiça)`);

  // --- partes ---
  await inserir('partes', [
    { escritorio_id: escritorio.id, processo_id: processos[0].id, polo: 'ativo',
      qualificacao: 'autora', nome: 'Joana Beltrame (fictícia)',
      documento: '11144477735', cliente_id: clientes[0].id },
    // Parte adversa: cliente_id nulo. É o que distingue "parte do processo" de
    // "cliente do escritório".
    { escritorio_id: escritorio.id, processo_id: processos[0].id,
      polo: 'passivo', qualificacao: 'ré',
      nome: 'Seguradora Fictícia S.A.', documento: '99888777000166',
      cliente_id: null },
    { escritorio_id: escritorio.id, processo_id: processos[1].id, polo: 'ativo',
      qualificacao: 'exequente', nome: 'Metalúrgica Vale Verde Ltda (fictícia)',
      documento: '11222333000181', cliente_id: clientes[1].id },
    { escritorio_id: escritorio.id, processo_id: processos[2].id,
      polo: 'passivo', qualificacao: 'reclamada',
      nome: 'Metalúrgica Vale Verde Ltda (fictícia)',
      documento: '11222333000181', cliente_id: clientes[1].id },
    { escritorio_id: escritorio.id, processo_id: processos[3].id, polo: 'ativo',
      qualificacao: 'requerente', nome: 'Joana Beltrame (fictícia)',
      documento: '11144477735', cliente_id: clientes[0].id },
  ]);

  // --- equipe: o associado entra em dois dos quatro processos ---
  // É isso que faz a lista dele ser diferente da da Helena — a prova visual
  // do recorte por atribuição.
  await inserir('processos_equipe', [
    { escritorio_id: escritorio.id, processo_id: processos[0].id,
      usuario_id: tiago.id, incluido_por: helena.id },
    { escritorio_id: escritorio.id, processo_id: processos[2].id,
      usuario_id: tiago.id, incluido_por: helena.id },
  ]);
  console.log('  associado atribuído a 2 dos 4 processos');

  // --- prazos sugeridos ---
  //
  // origem 'manual' e tipo_ato nulo: NÃO há regra de prazo ratificada no
  // sistema, e não vai haver até um advogado revisar. O fundamento diz o que
  // o dado é, para que ninguém o leia como orientação.
  const FUNDAMENTO = 'Dado de demonstração — não é orientação jurídica. '
    + 'A regra de prazo aplicável depende de revisão por advogado.';

  await inserir('prazos', [
    { escritorio_id: escritorio.id, processo_id: processos[0].id,
      origem: 'manual', contagem: 'dias_uteis', dias: 15,
      em_dobro: false, fundamento_dobro: null,
      data_termo_inicial: emDias(-2), data_inicio_contagem: emDias(-1),
      data_vencimento_sugerida: emDias(2), responsavel_id: helena.id,
      fundamento_legal: FUNDAMENTO, status: 'sugerido' },
    { escritorio_id: escritorio.id, processo_id: processos[1].id,
      origem: 'manual', contagem: 'dias_uteis', dias: 15, em_dobro: true,
      fundamento_dobro: 'Litisconsortes com procuradores distintos (exemplo '
        + 'de demonstração, não conferido)',
      data_termo_inicial: emDias(-1), data_inicio_contagem: emDias(0),
      data_vencimento_sugerida: emDias(21), responsavel_id: helena.id,
      fundamento_legal: FUNDAMENTO, status: 'sugerido' },
    { escritorio_id: escritorio.id, processo_id: processos[2].id,
      origem: 'manual', contagem: 'dias_corridos', dias: 5,
      em_dobro: false, fundamento_dobro: null,
      data_termo_inicial: emDias(-4), data_inicio_contagem: emDias(-3),
      data_vencimento_sugerida: emDias(1), responsavel_id: tiago.id,
      fundamento_legal: FUNDAMENTO, status: 'sugerido' },
  ]);
  console.log('  3 prazos sugeridos, aguardando confirmação humana');

  // --- tarefas ---
  await inserir('tarefas', [
    { escritorio_id: escritorio.id, processo_id: processos[0].id,
      titulo: 'Juntar procuração atualizada', responsavel_id: tiago.id,
      atribuido_por: helena.id, data_limite: emDias(1) },
  ]);

  const arquivo = '.credenciais-demo.local';
  writeFileSync(arquivo,
    'Contas de demonstração do projeto Supabase.\n'
    + 'Geradas por scripts/semear-demonstracao.mjs. Arquivo fora do git.\n'
    + 'São contas REAIS no projeto: apague-as antes de pôr dado de cliente.\n\n'
    + credenciais.join('\n') + '\n');

  console.log(`\nPronto. As senhas estão em ${arquivo} (fora do git).`);
}

main().catch((erro) => {
  console.error('\nFALHOU:', erro.message);
  process.exit(1);
});
