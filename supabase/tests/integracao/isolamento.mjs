// ============================================================================
// Prova de isolamento pela API HTTP, com usuários de verdade
// ============================================================================
//
// A suíte pgTAP prova as policies dentro do banco, trocando de identidade pelo
// mesmo parâmetro de sessão que o PostgREST usa. Isso cobre a regra, mas não
// cobre o caminho: a anon key que vai no bundle do navegador, o PostgREST
// traduzindo requisição em SQL, e o GoTrue emitindo o JWT. Se algum desses
// elos estiver configurado errado — a anon key com privilégio a mais, uma
// tabela exposta por engano no schema da API —, a suíte de banco passa e o
// dado vaza de todo jeito.
//
// Por isso este arquivo existe, e por isso ele usa fetch direto em vez de
// supabase-js: o que se quer testar é a API como ela responde, sem uma camada
// de cliente no meio que possa mascarar um status ou reescrever uma consulta.
// Zero dependência também significa que rodá-lo não exige npm install.
//
// >>> NÃO FOI EXECUTADO AINDA. <<<
// Exige um projeto Supabase — local (`supabase start`, que precisa de Docker)
// ou um de staging descartável. Rodar:
//
//   SUPABASE_URL=http://127.0.0.1:54321 \
//   SUPABASE_ANON_KEY=... \
//   SUPABASE_SERVICE_ROLE_KEY=... \
//   node supabase/tests/integracao/isolamento.mjs
//
// A service role key é usada só para semear e limpar. Ela NUNCA deve aparecer
// no bundle do cliente — é o segredo que o briefing manda manter no servidor.
// ============================================================================

const URL_BASE = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL_BASE || !ANON || !SERVICE) {
  console.error(
    'Faltam SUPABASE_URL, SUPABASE_ANON_KEY e SUPABASE_SERVICE_ROLE_KEY.\n' +
    'Com `supabase start`, o comando `supabase status` imprime as três.'
  );
  process.exit(2);
}

let passou = 0;
let falhou = 0;

function afirmar(condicao, descricao) {
  if (condicao) {
    passou++;
    console.log(`ok ${passou + falhou} - ${descricao}`);
  } else {
    falhou++;
    console.log(`not ok ${passou + falhou} - ${descricao}`);
  }
}

// Consulta a API REST com uma identidade. `token` é o JWT do usuário logado;
// sem ele, a requisição vale como visitante anônimo.
async function rest(caminho, { token, metodo = 'GET', corpo, prefer } = {}) {
  const cabecalhos = {
    apikey: ANON,
    Authorization: `Bearer ${token ?? ANON}`,
    'Content-Type': 'application/json',
  };
  if (prefer) cabecalhos.Prefer = prefer;

  const resposta = await fetch(`${URL_BASE}/rest/v1/${caminho}`, {
    method: metodo,
    headers: cabecalhos,
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const texto = await resposta.text();
  let dados = null;
  try { dados = texto ? JSON.parse(texto) : null; } catch { dados = texto; }
  return { status: resposta.status, dados };
}

async function admin(caminho, metodo, corpo) {
  const resposta = await fetch(`${URL_BASE}${caminho}`, {
    method: metodo,
    headers: {
      apikey: SERVICE,
      Authorization: `Bearer ${SERVICE}`,
      'Content-Type': 'application/json',
    },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const texto = await resposta.text();
  return { status: resposta.status, dados: texto ? JSON.parse(texto) : null };
}

// Cria a conta pelo GoTrue e devolve o id. email_confirm evita depender de
// caixa de e-mail num teste automatizado.
async function criarConta(email, senha) {
  const { status, dados } = await admin('/auth/v1/admin/users', 'POST', {
    email, password: senha, email_confirm: true,
  });
  if (status >= 300) throw new Error(`criar conta ${email}: ${JSON.stringify(dados)}`);
  return dados.id;
}

// Login de verdade, para obter um JWT emitido pelo GoTrue. É o que diferencia
// este teste da suíte de banco: aqui o token é real, com a duração e as claims
// que o servidor decide, e não um parâmetro de sessão que o teste escreveu.
async function entrar(email, senha) {
  const resposta = await fetch(`${URL_BASE}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: senha }),
  });
  const dados = await resposta.json();
  if (!dados.access_token) throw new Error(`login ${email}: ${JSON.stringify(dados)}`);
  return dados.access_token;
}

// Escritas de preparação vão por service_role, que passa por cima do RLS por
// desenho. É o caminho da Edge Function, e é assim que um escritório é criado
// em produção: junto do primeiro admin, numa transação.
async function semear(tabela, linhas) {
  const resposta = await fetch(`${URL_BASE}/rest/v1/${tabela}`, {
    method: 'POST',
    headers: {
      apikey: SERVICE,
      Authorization: `Bearer ${SERVICE}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(linhas),
  });
  const dados = await resposta.json();
  if (resposta.status >= 300) {
    throw new Error(`semear ${tabela}: ${JSON.stringify(dados)}`);
  }
  return dados;
}

const sufixo = Date.now();
const e = (nome) => `${nome}.${sufixo}@teste.flypi.local`;
const SENHA = 'senha-de-teste-descartavel-1';

async function main() {
  // --- preparação: dois escritórios completos, como na suíte de banco ---

  const [escritorioA] = await semear('escritorios', [{
    razao_social: `Escritorio A ${sufixo}`, uf_principal: 'RS',
  }]);
  const [escritorioB] = await semear('escritorios', [{
    razao_social: `Escritorio B ${sufixo}`, uf_principal: 'SP',
  }]);

  const idRespA = await criarConta(e('resp-a'), SENHA);
  const idRespB = await criarConta(e('resp-b'), SENHA);
  const idPortalA = await criarConta(e('portal-a'), SENHA);

  await semear('usuarios', [
    { id: idRespA, escritorio_id: escritorioA.id, nome: 'Resp A',
      email: e('resp-a'), papel: 'advogado_responsavel', admin_escritorio: true },
    { id: idRespB, escritorio_id: escritorioB.id, nome: 'Resp B',
      email: e('resp-b'), papel: 'advogado_responsavel', admin_escritorio: true },
  ]);

  const [clienteA] = await semear('clientes', [{
    escritorio_id: escritorioA.id, tipo_pessoa: 'fisica',
    nome: 'Cliente do A', uf: 'RS',
  }]);

  const [processoA] = await semear('processos', [{
    escritorio_id: escritorioA.id, advogado_responsavel_id: idRespA,
    situacao: 'ativo',
  }]);
  const [processoB] = await semear('processos', [{
    escritorio_id: escritorioB.id, advogado_responsavel_id: idRespB,
    situacao: 'ativo',
  }]);

  await semear('partes', [{
    escritorio_id: escritorioA.id, processo_id: processoA.id, polo: 'ativo',
    qualificacao: 'autor', nome: 'Cliente do A', cliente_id: clienteA.id,
  }]);

  await semear('usuarios_portal', [{
    id: idPortalA, escritorio_id: escritorioA.id, cliente_id: clienteA.id,
    nome: 'Portal A', email: e('portal-a'), criado_por: idRespA,
  }]);

  await semear('acessos_portal', [{
    escritorio_id: escritorioA.id, cliente_id: clienteA.id,
    processo_id: processoA.id, concedido_por: idRespA,
  }]);

  // --- visitante ---

  // A anon key vai no bundle do navegador e está publicada de fato. O que
  // impede um vazamento é ela não dar acesso a nada de domínio — e é isso que
  // se verifica aqui, pelo caminho real.
  const visitante = await rest('processos?select=id');
  afirmar(
    visitante.status >= 400 || (Array.isArray(visitante.dados) && visitante.dados.length === 0),
    'a anon key sozinha não devolve processo nenhum'
  );

  // --- equipe ---

  const tokenA = await entrar(e('resp-a'), SENHA);
  const tokenB = await entrar(e('resp-b'), SENHA);

  const vistosA = await rest('processos?select=id', { token: tokenA });
  afirmar(
    Array.isArray(vistosA.dados) && vistosA.dados.length === 1
      && vistosA.dados[0].id === processoA.id,
    'o responsável do A vê pela API exatamente o processo do A'
  );

  const cruzado = await rest(`processos?select=id&id=eq.${processoB.id}`, { token: tokenA });
  afirmar(
    Array.isArray(cruzado.dados) && cruzado.dados.length === 0,
    'pedir o id do processo do B pela API devolve lista vazia, não erro'
  );

  const vistosB = await rest('processos?select=id', { token: tokenB });
  afirmar(
    Array.isArray(vistosB.dados) && vistosB.dados.length === 1
      && vistosB.dados[0].id === processoB.id,
    'e o responsável do B vê exatamente o processo do B'
  );

  const escritaCruzada = await rest('processos', {
    token: tokenA, metodo: 'POST',
    corpo: { escritorio_id: escritorioB.id, situacao: 'ativo' },
  });
  afirmar(
    escritaCruzada.status >= 400,
    'a API recusa criar processo no escritório alheio'
  );

  // --- portal ---

  const tokenPortal = await entrar(e('portal-a'), SENHA);

  const portalProcessos = await rest('processos?select=id', { token: tokenPortal });
  afirmar(
    Array.isArray(portalProcessos.dados) && portalProcessos.dados.length === 1
      && portalProcessos.dados[0].id === processoA.id,
    'o cliente do portal vê pela API só o processo concedido'
  );

  const portalCruzado = await rest(`processos?select=id&id=eq.${processoB.id}`, {
    token: tokenPortal,
  });
  afirmar(
    Array.isArray(portalCruzado.dados) && portalCruzado.dados.length === 0,
    'o cliente do portal não alcança processo de outro escritório pela API'
  );

  // A tabela tem as anotações internas do escritório sobre o cliente, e RLS
  // autoriza linha e não coluna — por isso a proteção é não conceder a tabela.
  const portalClientes = await rest('clientes?select=id', { token: tokenPortal });
  afirmar(
    portalClientes.status >= 400
      || (Array.isArray(portalClientes.dados) && portalClientes.dados.length === 0),
    'o cliente do portal não lê a tabela de clientes pela API'
  );

  const portalPartes = await rest('partes?select=id', { token: tokenPortal });
  afirmar(
    portalPartes.status >= 400
      || (Array.isArray(portalPartes.dados) && portalPartes.dados.length === 0),
    'o cliente do portal não lê partes pela API, onde está o dado do adverso'
  );

  // --- limpeza ---

  // Só as contas: as linhas de domínio referenciam auth.users com ON DELETE
  // RESTRICT, então a limpeza tem que vir de dentro para fora. Num projeto de
  // staging descartável, recriar vale mais que desmontar — e por isso este
  // teste não deve rodar contra base com dado real.
  for (const id of [idRespA, idRespB, idPortalA]) {
    await admin(`/auth/v1/admin/users/${id}`, 'DELETE');
  }

  console.log(`\n1..${passou + falhou}`);
  if (falhou > 0) {
    console.error(`\n${falhou} de ${passou + falhou} FALHARAM`);
    process.exit(1);
  }
  console.log(`\nTODOS OS ${passou} TESTES PASSARAM`);
}

main().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
