-- ============================================================================
-- Prova: dois escritórios no mesmo banco não enxergam nada um do outro
-- ============================================================================
--
-- Critério de aceite do briefing, provado por teste e não por inspeção.
--
-- Como a prova é montada, e por que assim: cada asserção troca de identidade
-- pelo MESMO mecanismo que o PostgREST usa em produção (SET ROLE authenticated
-- mais o JWT em request.jwt.claims). Um helper que simulasse identidade de
-- outra forma provaria o comportamento do helper, não o do sistema.
--
-- Toda asserção de vazamento é pela negativa e por contagem: o que se afirma é
-- que o conjunto é VAZIO, não que a consulta deu erro. Erro de permissão já
-- seria um vazamento menor — informaria que a linha existe.
-- ============================================================================

begin;

select plan(34);

select cenario.montar();

-- ----------------------------------------------------------------------------
-- Resolução do tenant
-- ----------------------------------------------------------------------------

select teste.entrar_como(id.resp_a) from cenario.ids id;
select is(app.escritorio_atual(), (select escritorio_a from cenario.ids),
  'escritorio_atual() resolve o escritório do responsável do A');
select ok(app.enxerga_escritorio_todo(),
  'advogado responsável enxerga o escritório todo');
select ok(not app.eh_portal(),
  'usuário interno não é reconhecido como portal');
select teste.sair();

-- ----------------------------------------------------------------------------
-- Leitura: cada lado vê o seu, e só o seu
-- ----------------------------------------------------------------------------

select teste.entrar_como(id.resp_a) from cenario.ids id;

-- Dois: o processo comum e o que não tem portal. O sigiloso está fora porque
-- SELECT direto não alcança processo sob segredo — a leitura dele passa pela
-- RPC auditada, provada no arquivo de auditoria.
select is((select count(*) from processos)::int, 2,
  'responsável do A vê os 2 processos não sigilosos do A');

select is_empty($$
  select id from processos where escritorio_id
    = (select escritorio_b from cenario.ids)
$$, 'responsável do A não vê nenhum processo do B');

-- A tentativa mais direta que um atacante faria: pedir o id exato. A resposta
-- certa é conjunto vazio.
select is_empty($$
  select id from processos where id = (select processo_b from cenario.ids)
$$, 'responsável do A não alcança processo do B nem pedindo o id exato');

select is((select count(*) from clientes)::int, 1,
  'responsável do A vê apenas o cliente do A');
select is_empty($$
  select id from clientes where id = (select cliente_b from cenario.ids)
$$, 'responsável do A não alcança cliente do B pelo id');

-- Três: as duas partes do processo comum (autor e adversa) e a do processo sem
-- portal. As do sigiloso ficam invisíveis junto com o processo, o que é a
-- herança de visibilidade funcionando.
select is((select count(*) from partes)::int, 3,
  'responsável do A vê só as partes dos processos que ele vê');
select is_empty($$
  select id from partes where escritorio_id
    = (select escritorio_b from cenario.ids)
$$, 'responsável do A não vê parte de processo do B');

select is((select count(*) from usuarios)::int, 4,
  'responsável do A vê os 4 usuários do A');
select is_empty($$
  select id from usuarios where id = (select resp_b from cenario.ids)
$$, 'responsável do A não vê usuário do B');

select is((select count(*) from oabs_usuario)::int, 2,
  'responsável do A vê as 2 inscrições OAB do A');
select is((select count(*) from escritorios)::int, 1,
  'responsável do A vê apenas o próprio escritório');

select teste.sair();

-- O lado espelhado. Sem esta metade, o teste passaria com uma policy que
-- liberasse tudo para o A e nada para o B.
select teste.entrar_como(id.resp_b) from cenario.ids id;
select is((select count(*) from processos)::int, 1,
  'responsável do B vê o 1 processo não sigiloso do B');
select is_empty($$
  select id from processos where escritorio_id
    = (select escritorio_a from cenario.ids)
$$, 'responsável do B não vê nenhum processo do A');
select is((select count(*) from clientes)::int, 1,
  'responsável do B vê apenas o cliente do B');
select teste.sair();

-- ----------------------------------------------------------------------------
-- Escrita: não se escreve no escritório alheio
-- ----------------------------------------------------------------------------

select teste.entrar_como(id.resp_a) from cenario.ids id;

select throws_ok($$
  insert into processos (escritorio_id, numero_cnj, tribunal)
  values ((select escritorio_b from cenario.ids), '90000000000000000001', 'TJSP')
$$, '42501', null,
  'responsável do A não consegue inserir processo no escritório do B');

-- UPDATE cross-tenant não dá erro: a linha simplesmente não está no conjunto
-- que o USING autoriza, e zero linhas afetadas é o resultado correto. Se o
-- USING fosse esquecido numa policy, esta asserção acusaria 1.
select is(teste.linhas_afetadas(format($cmd$
  update processos set situacao = 'suspenso' where id = %L
$cmd$, (select processo_b from cenario.ids))), 0,
  'UPDATE em processo do B não afeta linha nenhuma');

select throws_ok($$
  insert into clientes (escritorio_id, tipo_pessoa, nome)
  values ((select escritorio_b from cenario.ids), 'fisica', 'Invasor')
$$, '42501', null,
  'responsável do A não consegue cadastrar cliente no escritório do B');

select teste.sair();

-- ----------------------------------------------------------------------------
-- Coerência de tenant: FK garante que o pai existe, não que ele seja meu
-- ----------------------------------------------------------------------------

-- Rodando como dono (sem RLS) para provar que a trava é do trigger e não da
-- policy. Se dependesse só da policy, um caminho com service_role — a Edge
-- Function, que passa por cima do RLS por desenho — criaria a linha
-- inconsistente sem nenhum aviso.
select throws_ok(format($$
  insert into partes (escritorio_id, processo_id, polo, qualificacao, nome)
  values (%L, %L, 'ativo', 'autor', 'Parte cruzada')
$$, (select escritorio_a from cenario.ids),
    (select processo_b from cenario.ids)),
  '23503', null,
  'parte do A pendurada em processo do B é rejeitada pelo trigger, não só '
  'pela policy');

select throws_ok(format($$
  update usuarios set escritorio_id = %L where id = %L
$$, (select escritorio_b from cenario.ids),
    (select resp_a from cenario.ids)),
  '23514', null,
  'escritorio_id é imutável: não se migra usuário entre tenants por UPDATE');

-- ----------------------------------------------------------------------------
-- O recorte de associado e estagiário
-- ----------------------------------------------------------------------------

select teste.entrar_como(id.assoc_a) from cenario.ids id;
select is((select count(*) from processos)::int, 1,
  'associado do A vê só o processo em que foi incluído na equipe');
select is_empty($$
  select id from processos
   where id = (select processo_a_sem_portal from cenario.ids)
$$, 'associado do A não vê processo do próprio escritório sem atribuição');
select is((select count(*) from clientes)::int, 0,
  'associado não enxerga a carteira de clientes do escritório');
select teste.sair();

-- O associado sem atribuição nenhuma. É ele que distingue "vê porque foi
-- atribuído" de "vê porque é do escritório": se a policy tivesse liberado o
-- escritório todo, o associado acima ainda passaria e só este acusaria.
select teste.entrar_como(id.assoc_a_sem_caso) from cenario.ids id;
select is((select count(*) from processos)::int, 0,
  'associado sem atribuição nenhuma não vê processo algum');
select is((select count(*) from partes)::int, 0,
  'associado sem atribuição não vê parte alguma');
select teste.sair();

-- A secretaria cadastra processo e cliente, então precisa enxergar o
-- escritório todo — o briefing lhe dá essa função.
select teste.entrar_como(id.secretaria_a) from cenario.ids id;
select is((select count(*) from processos)::int, 2,
  'secretaria do A enxerga os processos do escritório');
select is_empty($$
  select id from processos where escritorio_id
    = (select escritorio_b from cenario.ids)
$$, 'secretaria do A não enxerga processo do B');
select teste.sair();

-- ----------------------------------------------------------------------------
-- Escalada de privilégio por UPDATE em coluna própria
-- ----------------------------------------------------------------------------

-- A policy autoriza o associado a atualizar a própria linha (para corrigir o
-- nome). Policy autoriza linha, não coluna — sem o trigger, o mesmo UPDATE
-- promoveria o associado a admin, e daí a todo o escritório.
select teste.entrar_como(id.assoc_a) from cenario.ids id;
select throws_ok($$
  update usuarios set admin_escritorio = true where id = auth.uid()
$$, '42501', null,
  'associado não consegue se promover a admin pela própria linha');
select throws_ok($$
  update usuarios set papel = 'advogado_responsavel' where id = auth.uid()
$$, '42501', null,
  'associado não consegue trocar o próprio papel');
select lives_ok($$
  update usuarios set nome = 'Assoc A corrigido' where id = auth.uid()
$$, 'associado consegue corrigir o próprio nome');
select teste.sair();

-- ----------------------------------------------------------------------------
-- Visitante não autenticado
-- ----------------------------------------------------------------------------

-- Segunda trava, independente do RLS: `anon` não tem privilégio de tabela
-- nenhum nas tabelas de domínio. Um erro futuro numa policy ainda não abre o
-- dado para a internet.
select teste.entrar_como_visitante();
select throws_ok($$ select count(*) from processos $$, '42501', null,
  'visitante não autenticado não tem sequer privilégio de leitura em processos');
select throws_ok($$ select count(*) from clientes $$, '42501', null,
  'visitante não autenticado não tem privilégio de leitura em clientes');
select teste.sair();

select * from finish();
rollback;
