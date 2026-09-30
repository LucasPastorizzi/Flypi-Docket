-- ============================================================================
-- Prova: todo acesso a processo sob sigilo fica registrado
-- ============================================================================
--
-- Critério de aceite do briefing. O Postgres não tem trigger de SELECT, então
-- o que se prova aqui é que o caminho de leitura que registra é o ÚNICO
-- caminho: o SELECT direto não devolve processo sigiloso para ninguém — nem
-- para o responsável pelo caso, nem para o cliente que é parte.
--
-- Prova também o acordo entre as duas cópias da regra de visibilidade. A
-- policy e app.pode_ver_processo() dizem a mesma coisa, e isso é verificado
-- para cada perfil do cenário em vez de confiado à atenção de quem editar uma
-- das duas.
-- ============================================================================

begin;

select plan(27);

select cenario.montar();

-- ----------------------------------------------------------------------------
-- O SELECT direto não alcança o sigiloso, para ninguém
-- ----------------------------------------------------------------------------

select teste.entrar_como(id.resp_a) from cenario.ids id;
select is_empty($$
  select id from processos
   where id = (select processo_a_sigiloso from cenario.ids)
$$, 'nem o advogado responsável lê processo sigiloso por SELECT direto');
select teste.sair();

select teste.entrar_como(id.portal_a) from cenario.ids id;
select is_empty($$
  select id from processos
   where id = (select processo_a_sigiloso from cenario.ids)
$$, 'nem o cliente que é parte lê processo sigiloso por SELECT direto');
select teste.sair();

-- ----------------------------------------------------------------------------
-- O caminho auditado devolve o processo, e registra
-- ----------------------------------------------------------------------------

select teste.entrar_como(id.resp_a) from cenario.ids id;

select is((
  select count(*) from ver_processo(
    (select processo_a_sigiloso from cenario.ids))
)::int, 1, 'ver_processo() devolve o processo sigiloso a quem pode vê-lo');

select is((
  select count(*) from auditoria
   where acao = 'leitura'
     and processo_id = (select processo_a_sigiloso from cenario.ids)
     and ator_id = (select resp_a from cenario.ids)
     and dados_depois ->> 'resultado' = 'permitido'
)::int, 1, 'e o acesso ficou registrado, com o ator e o resultado');

select is((
  select ator_tipo::text from auditoria
   where processo_id = (select processo_a_sigiloso from cenario.ids)
     and ator_id = (select resp_a from cenario.ids)
), 'equipe', 'o registro identifica o acesso como vindo da equipe');

-- Duas leituras, dois registros. A trilha é de acessos, não de autorizações:
-- "quem viu e quando" precisa de uma linha por vez que viu.
select is((select count(*) from ver_processo(
    (select processo_a_sigiloso from cenario.ids)))::int, 1,
  'a segunda leitura também devolve o processo');
select is((
  select count(*) from auditoria
   where processo_id = (select processo_a_sigiloso from cenario.ids)
     and ator_id = (select resp_a from cenario.ids)
)::int, 2, 'e gerou um segundo registro: a trilha conta acessos, não permissões');

-- ----------------------------------------------------------------------------
-- Tentativa negada
-- ----------------------------------------------------------------------------

-- Zero linhas, e não erro. Erro distinguiria "não pode ver" de "não existe", e
-- quem sonda ids descobriria quais existem.
select is((
  select count(*) from ver_processo(
    (select processo_b_sigiloso from cenario.ids))
)::int, 0, 'ver_processo() devolve conjunto vazio para processo de outro '
           'escritório, não erro');

select is((
  select count(*) from ver_processo(
    '99999999-9999-9999-9999-999999999999'::uuid)
)::int, 0, 'ver_processo() de id inexistente devolve vazio');

select teste.sair();

-- A tentativa negada em processo sigiloso é registrada, e fica na trilha do
-- escritório DONO do processo. É ele que precisa saber que alguém tentou — e
-- acesso negado é o evento que mais interessa numa investigação, então
-- registrar só o que deu certo deixaria a trilha cega justamente onde ela
-- serve.
select is((
  select count(*) from auditoria
   where processo_id = (select processo_b_sigiloso from cenario.ids)
     and escritorio_id = (select escritorio_b from cenario.ids)
     and ator_id = (select resp_a from cenario.ids)
     and dados_depois ->> 'resultado' = 'negado'
)::int, 1, 'a tentativa negada fica registrada na trilha do escritório dono');

-- Id inexistente não gera registro: encheria a auditoria com ruído de
-- digitação, e não há processo a cuja trilha o evento pertenceria.
select is((
  select count(*) from auditoria
   where processo_id = '99999999-9999-9999-9999-999999999999'
)::int, 0, 'id inexistente não gera ruído na auditoria');

-- ----------------------------------------------------------------------------
-- O portal pelo caminho auditado
-- ----------------------------------------------------------------------------

select teste.entrar_como(id.portal_a) from cenario.ids id;

select is((
  select count(*) from ver_processo(
    (select processo_a_sigiloso from cenario.ids))
)::int, 1,
  'o cliente que é parte lê o processo sigiloso pelo caminho auditado');

-- Concessão é o que autoriza, inclusive por este caminho. O cliente é parte
-- deste processo e ainda assim não o alcança.
select is((
  select count(*) from ver_processo(
    (select processo_a_sem_portal from cenario.ids))
)::int, 0,
  'sem concessão o cliente não alcança o processo nem pela RPC');

select is((select count(*) from auditoria)::int, 0,
  'o cliente do portal não lê a trilha de auditoria');

select teste.sair();

-- A conferência do registro é feita pelo escritório, e não pelo próprio
-- cliente: ele acabou de provar que não lê a trilha. É o escritório que
-- precisa saber que o portal acessou o processo sigiloso.
select teste.entrar_como(id.resp_a) from cenario.ids id;
select is((
  select ator_tipo::text from auditoria
   where processo_id = (select processo_a_sigiloso from cenario.ids)
     and ator_id = (select portal_a from cenario.ids)
), 'portal', 'o acesso do portal ficou registrado como portal, não como equipe');
select teste.sair();

-- ----------------------------------------------------------------------------
-- Append-only
-- ----------------------------------------------------------------------------

select teste.entrar_como(id.resp_a) from cenario.ids id;

select ok((select count(*) from auditoria) > 0,
  'o advogado responsável lê a trilha do próprio escritório');

-- Registro de acesso que pode ser alterado não é registro de acesso.
select throws_ok($$
  update auditoria set ator_id = null where true
$$, '42501', null, 'auditoria não aceita UPDATE');
select throws_ok($$
  delete from auditoria where true
$$, '42501', null, 'auditoria não aceita DELETE');

-- Log forjável tem valor negativo: dá a impressão de trilha onde não há. Todo
-- registro passa por app.registrar(), que decide o ator pelo contexto.
select throws_ok(format($$
  insert into auditoria (escritorio_id, ator_id, ator_tipo, acao, entidade)
  values (%L, %L, 'equipe', 'leitura', 'processos')
$$, (select escritorio_a from cenario.ids),
    (select resp_b from cenario.ids)),
  '42501', null,
  'a aplicação não insere em auditoria direto: não dá para forjar ator');

-- E o caminho indireto também está fechado. O Postgres concede EXECUTE a
-- PUBLIC em toda função nova, então revogar é obrigatório e é fácil esquecer:
-- sem o revoke, bastaria chamar a função de registro para escrever na trilha
-- o que se quisesse, em nome de qualquer escritório.
select throws_ok(format($$
  select app.registrar('leitura', 'processos', null, null, %L)
$$, (select escritorio_b from cenario.ids)),
  '42501', null,
  'nem pela função de registro: app.registrar() não é chamável pela aplicação');

select teste.sair();

-- A trilha expõe o comportamento de cada membro da equipe, então quem a lê é
-- quem responde pelo escritório.
select teste.entrar_como(id.assoc_a) from cenario.ids id;
select is((select count(*) from auditoria)::int, 0,
  'o associado não lê a trilha de auditoria do escritório');
select teste.sair();

-- ----------------------------------------------------------------------------
-- As duas cópias da regra de visibilidade concordam
-- ----------------------------------------------------------------------------

-- A policy de `processos` e app.pode_ver_processo() dizem a mesma coisa sobre
-- quem vê o quê. A duplicação é inevitável — policy não se consulta como
-- predicado, e a RPC é SECURITY DEFINER e não passa por ela —, mas ela não
-- precisa ser confiada à atenção de quem editar uma das duas.
--
-- O filtro de sigilo na segunda consulta é a única diferença legítima entre
-- as duas: a função autoriza o sigiloso de propósito, porque o caminho dela
-- registra.
select set_eq($$
  select id from processos
$$, $$
  select pid from cenario.processos_todos
   where not sigiloso and app.pode_ver_processo(pid)
$$, 'policy e pode_ver_processo concordam para o responsável do A')
  from (select teste.entrar_como((select resp_a from cenario.ids))) _;

select set_eq($$
  select id from processos
$$, $$
  select pid from cenario.processos_todos
   where not sigiloso and app.pode_ver_processo(pid)
$$, 'policy e pode_ver_processo concordam para o associado com atribuição')
  from (select teste.entrar_como((select assoc_a from cenario.ids))) _;

select set_eq($$
  select id from processos
$$, $$
  select pid from cenario.processos_todos
   where not sigiloso and app.pode_ver_processo(pid)
$$, 'policy e pode_ver_processo concordam para o associado sem atribuição')
  from (select teste.entrar_como((select assoc_a_sem_caso from cenario.ids))) _;

select set_eq($$
  select id from processos
$$, $$
  select pid from cenario.processos_todos
   where not sigiloso and app.pode_ver_processo(pid)
$$, 'policy e pode_ver_processo concordam para a secretaria')
  from (select teste.entrar_como((select secretaria_a from cenario.ids))) _;

select set_eq($$
  select id from processos
$$, $$
  select pid from cenario.processos_todos
   where not sigiloso and app.pode_ver_processo(pid)
$$, 'policy e pode_ver_processo concordam para o responsável do B')
  from (select teste.entrar_como((select resp_b from cenario.ids))) _;

select set_eq($$
  select id from processos
$$, $$
  select pid from cenario.processos_todos
   where not sigiloso and app.pode_ver_processo(pid)
$$, 'policy e pode_ver_processo concordam para o cliente do portal')
  from (select teste.entrar_como((select portal_a from cenario.ids))) _;

select teste.sair();

select * from finish();
rollback;
