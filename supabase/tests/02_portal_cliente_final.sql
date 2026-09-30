-- ============================================================================
-- Prova: o cliente final vê só os processos em que é parte — e nada mais
-- ============================================================================
--
-- Critério de aceite do briefing, e a policy que o próprio briefing manda
-- testar explicitamente.
--
-- O cenário foi montado para que "nada mais" tenha material para aparecer. O
-- cliente do A é parte em TRÊS processos e tem concessão para DOIS, sendo um
-- deles sigiloso. Se a policy estivesse recortando por cliente em vez de por
-- concessão, ou ignorando o sigilo, a contagem acusaria.
-- ============================================================================

begin;

select plan(28);

select cenario.montar();

-- ----------------------------------------------------------------------------
-- O cliente do portal não é do escritório
-- ----------------------------------------------------------------------------

select teste.entrar_como(id.portal_a) from cenario.ids id;

-- A base de tudo: escritorio_atual() devolve NULL para quem é do portal, e é
-- assim que as policies internas o negam sem precisar de cláusula própria.
-- Uma tabela de domínio nova que siga a convenção nasce fechada para ele.
select is(app.escritorio_atual(), null,
  'escritorio_atual() é NULL para login do portal');
select ok(app.eh_portal(),
  'o login do portal é reconhecido como portal');
select ok(not app.enxerga_escritorio_todo(),
  'login do portal não enxerga o escritório');
select is(app.cliente_portal_atual(), (select cliente_a from cenario.ids),
  'cliente_portal_atual() resolve o cliente do login');

-- ----------------------------------------------------------------------------
-- O que ele vê
-- ----------------------------------------------------------------------------

-- Um só: o processo com concessão e sem sigilo. Ele é parte em três.
select is((select count(*) from processos)::int, 1,
  'cliente do portal vê exatamente 1 processo, dos 3 em que é parte');

select results_eq($$
  select id from processos
$$, $$
  select processo_a from cenario.ids
$$, 'e o processo que ele vê é justamente o que lhe foi concedido');

-- Ele É parte deste processo. Sem a concessão, não vê — que é a diferença
-- entre acesso concedido e acesso deduzido.
select is_empty($$
  select id from processos
   where id = (select processo_a_sem_portal from cenario.ids)
$$, 'não vê processo do próprio escritório e do próprio nome sem concessão');

-- Concessão ele tem; o que barra é o sigilo. A leitura de processo sob segredo
-- passa pela RPC que registra o acesso, e isso vale para o cliente também —
-- "todo acesso a processo sob sigilo fica registrado" não abre exceção para
-- quem é parte.
select is_empty($$
  select id from processos
   where id = (select processo_a_sigiloso from cenario.ids)
$$, 'não lê por SELECT direto o processo sigiloso que lhe foi concedido');

-- ----------------------------------------------------------------------------
-- O que ele não alcança de jeito nenhum
-- ----------------------------------------------------------------------------

select is_empty($$
  select id from processos where id = (select processo_b from cenario.ids)
$$, 'cliente do portal do A não alcança processo do escritório B pelo id');

-- A tabela tem as anotações internas do escritório sobre o próprio cliente.
-- RLS autoriza linha e não coluna, então a proteção é não conceder a tabela.
select is((select count(*) from clientes)::int, 0,
  'cliente do portal não lê a tabela de clientes, nem o próprio cadastro');

-- Aqui está o CPF e a qualificação da parte adversa — dado pessoal de
-- terceiro, que não é do cliente só porque o processo é dele.
select is((select count(*) from partes)::int, 0,
  'cliente do portal não lê partes, onde está o dado da parte adversa');

select is((select count(*) from usuarios)::int, 0,
  'cliente do portal não lê a equipe do escritório');
select is((select count(*) from oabs_usuario)::int, 0,
  'cliente do portal não lê as inscrições OAB do escritório');
select is((select count(*) from escritorios)::int, 0,
  'cliente do portal não lê o cadastro do escritório');
select is((select count(*) from processos_equipe)::int, 0,
  'cliente do portal não lê quem trabalha no caso');

-- Ele chega aos processos pela função SECURITY DEFINER, sem ler a tabela de
-- concessões. Menos superfície, e nada de ciclo entre esta policy e a de
-- processos.
select is((select count(*) from acessos_portal)::int, 0,
  'cliente do portal não lê a tabela de concessões que o autoriza');

-- Só a própria linha: nem os outros logins do mesmo cliente PJ.
select is((select count(*) from usuarios_portal)::int, 1,
  'cliente do portal vê apenas a própria linha em usuarios_portal');

-- ----------------------------------------------------------------------------
-- Ele não escreve
-- ----------------------------------------------------------------------------

select is(teste.linhas_afetadas(format($cmd$
  update processos set situacao = 'encerrado' where id = %L
$cmd$, (select processo_a from cenario.ids))), 0,
  'cliente do portal não altera o processo que consulta');

-- A escalada mais direta que existiria: conceder acesso a si mesmo.
select throws_ok(format($$
  insert into acessos_portal (escritorio_id, cliente_id, processo_id,
                              concedido_por)
  values (%L, %L, %L, %L)
$$, (select escritorio_a from cenario.ids),
    (select cliente_a from cenario.ids),
    (select processo_a_sem_portal from cenario.ids),
    (select resp_a from cenario.ids)),
  '42501', null,
  'cliente do portal não consegue conceder acesso a si mesmo');

select throws_ok($$
  update usuarios_portal set cliente_id
    = (select cliente_b from cenario.ids) where id = auth.uid()
$$, '42501', null,
  'cliente do portal não consegue se apontar para outro cliente');

select teste.sair();

-- ----------------------------------------------------------------------------
-- O outro portal, para provar que o recorte não é só do lado A
-- ----------------------------------------------------------------------------

select teste.entrar_como(id.portal_b) from cenario.ids id;
select results_eq($$
  select id from processos
$$, $$
  select processo_b from cenario.ids
$$, 'cliente do portal do B vê só o processo do B que lhe foi concedido');
select is_empty($$
  select id from processos where id = (select processo_a from cenario.ids)
$$, 'cliente do portal do B não alcança processo do A');
select teste.sair();

-- ----------------------------------------------------------------------------
-- Revogação
-- ----------------------------------------------------------------------------

-- A razão de a concessão ser linha e não dedução: tem como desfazer, na
-- consulta seguinte, sem tocar em dado processual.
select teste.entrar_como(id.resp_a) from cenario.ids id;
select is(teste.linhas_afetadas(format($cmd$
  update acessos_portal
     set revogado_em = now(), revogado_por = %L
   where cliente_id = %L and processo_id = %L
$cmd$, (select resp_a from cenario.ids),
       (select cliente_a from cenario.ids),
       (select processo_a from cenario.ids))), 1,
  'o escritório consegue revogar a concessão');
select teste.sair();

select teste.entrar_como(id.portal_a) from cenario.ids id;
select is((select count(*) from processos)::int, 0,
  'revogada a concessão, o cliente do portal não vê mais nada');
select teste.sair();

-- ----------------------------------------------------------------------------
-- A invariante que sustenta as duas tabelas de usuário
-- ----------------------------------------------------------------------------

-- Sem este trigger a separação entre equipe e portal é convenção; com ele é
-- garantia. A mesma conta nas duas tabelas faria escritorio_atual() responder
-- para um login do portal, e o cliente enxergaria o escritório inteiro.
select throws_ok(format($$
  insert into usuarios_portal (id, escritorio_id, cliente_id, nome, email)
  values (%L, %L, %L, 'Conta dupla', 'dupla@a.com.br')
$$, (select resp_a from cenario.ids),
    (select escritorio_a from cenario.ids),
    (select cliente_a from cenario.ids)),
  '23505', null,
  'uma conta que já é usuário interno não pode virar login de portal');

-- Os dois casos que provam por que esses triggers são SECURITY DEFINER. Foram
-- escritos depois de a suíte pegar o erro: a primeira versão dos triggers
-- consultava as tabelas com a identidade de quem escrevia, e portanto passava
-- pela RLS dela.

-- 1) Erro espúrio: o responsável do A não LÊ o processo sigiloso por SELECT
-- direto, mas conceder portal nele é ato legítimo — o cliente é parte e tem
-- direito de acompanhar. Com o trigger sujeito à RLS do chamador, a
-- verificação "o cliente figura como parte?" não achava a parte e recusava uma
-- operação válida.
select teste.entrar_como(id.resp_a) from cenario.ids id;
select is(teste.linhas_afetadas(format($cmd$
  update acessos_portal set revogado_em = now(), revogado_por = %L
   where cliente_id = %L and processo_id = %L
$cmd$, (select resp_a from cenario.ids),
       (select cliente_a from cenario.ids),
       (select processo_a_sigiloso from cenario.ids))), 1,
  'a concessão de processo sigiloso pode ser revogada por quem não o lê');

select lives_ok(format($$
  insert into acessos_portal (escritorio_id, cliente_id, processo_id,
                              concedido_por)
  values (%L, %L, %L, %L)
$$, (select escritorio_a from cenario.ids),
    (select cliente_a from cenario.ids),
    (select processo_a_sigiloso from cenario.ids),
    (select resp_a from cenario.ids)),
  'e pode ser concedida de novo, ainda que o concedente não leia o processo');

-- 2) O furo que importa: uma conta que é usuário interno do ESCRITÓRIO B não
-- pode virar login de portal do A. O admin do A não vê a linha de B, então um
-- trigger sujeito à RLS dele não a encontraria e deixaria passar — e a conta
-- ficaria nas duas tabelas, que é justamente o que faria um login de portal
-- enxergar um escritório inteiro. A invariante tem que valer contra o banco,
-- não contra o que o autor da escrita consegue ver.
select throws_ok(format($$
  insert into usuarios_portal (id, escritorio_id, cliente_id, nome, email)
  values (%L, %L, %L, 'Conta cruzada', 'cruzada@a.com.br')
$$, (select resp_b from cenario.ids),
    (select escritorio_a from cenario.ids),
    (select cliente_a from cenario.ids)),
  '23505', null,
  'conta que é usuário interno de OUTRO escritório também é recusada como '
  'login de portal');
select teste.sair();

select * from finish();
rollback;
