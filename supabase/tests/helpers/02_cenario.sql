-- ============================================================================
-- Cenário das provas de isolamento
-- ============================================================================
--
-- Dois escritórios completos no MESMO banco, com dado equivalente dos dois
-- lados, mais um cliente final com acesso ao portal. Os ids são fixos e
-- legíveis para que uma asserção que falhe diga de quem é a linha que vazou
-- sem precisar de consulta extra.
--
-- Por que os dois lados são simétricos: um teste em que o escritório B está
-- vazio passaria mesmo com o isolamento quebrado — não há o que vazar. Cada
-- escritório tem processo, cliente, parte, associado e processo sigiloso, de
-- modo que qualquer furo tem material para aparecer nas duas direções.
-- ============================================================================

create schema if not exists cenario;

-- Um lugar só para os ids, para que os testes não repitam literais uuid.
create or replace view cenario.ids as
select
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid as escritorio_a,
  'bbbbbbbb-0000-0000-0000-000000000001'::uuid as escritorio_b,
  -- Equipe do A
  'aaaaaaaa-1111-0000-0000-000000000001'::uuid as resp_a,
  'aaaaaaaa-1111-0000-0000-000000000002'::uuid as assoc_a,
  'aaaaaaaa-1111-0000-0000-000000000003'::uuid as secretaria_a,
  'aaaaaaaa-1111-0000-0000-000000000004'::uuid as assoc_a_sem_caso,
  -- Equipe do B
  'bbbbbbbb-1111-0000-0000-000000000001'::uuid as resp_b,
  'bbbbbbbb-1111-0000-0000-000000000002'::uuid as assoc_b,
  -- Clientes
  'aaaaaaaa-2222-0000-0000-000000000001'::uuid as cliente_a,
  'bbbbbbbb-2222-0000-0000-000000000001'::uuid as cliente_b,
  -- Processos
  'aaaaaaaa-3333-0000-0000-000000000001'::uuid as processo_a,
  'aaaaaaaa-3333-0000-0000-000000000002'::uuid as processo_a_sigiloso,
  'aaaaaaaa-3333-0000-0000-000000000003'::uuid as processo_a_sem_portal,
  'bbbbbbbb-3333-0000-0000-000000000001'::uuid as processo_b,
  'bbbbbbbb-3333-0000-0000-000000000002'::uuid as processo_b_sigiloso,
  -- Logins de portal
  'aaaaaaaa-4444-0000-0000-000000000001'::uuid as portal_a,
  'bbbbbbbb-4444-0000-0000-000000000001'::uuid as portal_b;

create or replace function cenario.montar()
returns void
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  i record;
begin
  select * into i from cenario.ids;

  -- As contas de autenticação. No Supabase o GoTrue cria estas linhas; aqui
  -- elas são semeadas porque as FKs do schema apontam para auth.users.
  insert into auth.users (id, email) values
    (i.resp_a, 'resp@a.adv.br'),
    (i.assoc_a, 'assoc@a.adv.br'),
    (i.secretaria_a, 'sec@a.adv.br'),
    (i.assoc_a_sem_caso, 'assoc2@a.adv.br'),
    (i.resp_b, 'resp@b.adv.br'),
    (i.assoc_b, 'assoc@b.adv.br'),
    (i.portal_a, 'cliente@a.com.br'),
    (i.portal_b, 'cliente@b.com.br')
  on conflict (id) do nothing;

  insert into escritorios (id, razao_social, cnpj, uf_principal) values
    (i.escritorio_a, 'Escritorio A Advogados', '11111111111111', 'RS'),
    (i.escritorio_b, 'Escritorio B Advogados', '22222222222222', 'SP');

  insert into usuarios (id, escritorio_id, nome, email, papel, admin_escritorio)
  values
    (i.resp_a, i.escritorio_a, 'Resp A', 'resp@a.adv.br',
     'advogado_responsavel', true),
    (i.assoc_a, i.escritorio_a, 'Assoc A', 'assoc@a.adv.br',
     'advogado_associado', false),
    (i.secretaria_a, i.escritorio_a, 'Sec A', 'sec@a.adv.br',
     'secretaria', false),
    -- Associado do mesmo escritório SEM atribuição em processo nenhum. É ele
    -- que prova que o recorte de associado é por atribuição e não por
    -- pertencer ao escritório — sem este usuário, a policy poderia estar
    -- liberando o escritório todo e o teste não notaria.
    (i.assoc_a_sem_caso, i.escritorio_a, 'Assoc A2', 'assoc2@a.adv.br',
     'advogado_associado', false),
    (i.resp_b, i.escritorio_b, 'Resp B', 'resp@b.adv.br',
     'advogado_responsavel', true),
    (i.assoc_b, i.escritorio_b, 'Assoc B', 'assoc@b.adv.br',
     'advogado_associado', false);

  insert into oabs_usuario (escritorio_id, usuario_id, numero, seccional) values
    (i.escritorio_a, i.resp_a, '11111', 'RS'),
    -- Duas seccionais para o mesmo advogado: o caso que o briefing cita e que
    -- motiva a tabela existir.
    (i.escritorio_a, i.resp_a, '22222', 'SC'),
    (i.escritorio_b, i.resp_b, '33333', 'SP');

  insert into tribunais (sigla, nome, segmento, uf) values
    ('TJRS', 'Tribunal de Justica do RS', 'estadual', 'RS'),
    ('TJSP', 'Tribunal de Justica de SP', 'estadual', 'SP')
  on conflict (sigla) do nothing;

  insert into clientes (id, escritorio_id, tipo_pessoa, nome, documento, uf)
  values
    (i.cliente_a, i.escritorio_a, 'fisica', 'Cliente do A',
     '11111111111', 'RS'),
    (i.cliente_b, i.escritorio_b, 'fisica', 'Cliente do B',
     '22222222222', 'SP');

  insert into processos (
    id, escritorio_id, numero_cnj, tribunal, situacao, segredo_justica,
    advogado_responsavel_id, valor_causa
  ) values
    (i.processo_a, i.escritorio_a, '10000000000000000001', 'TJRS', 'ativo',
     false, i.resp_a, 10000.00),
    (i.processo_a_sigiloso, i.escritorio_a, '10000000000000000002', 'TJRS',
     'ativo', true, i.resp_a, 20000.00),
    -- Processo do mesmo cliente do portal, mas SEM concessão. Prova que o
    -- portal é recortado por concessão e não por cliente: sem ele, a policy
    -- poderia estar liberando tudo do cliente e o teste passaria.
    (i.processo_a_sem_portal, i.escritorio_a, '10000000000000000003', 'TJRS',
     'ativo', false, i.resp_a, 30000.00),
    (i.processo_b, i.escritorio_b, '20000000000000000001', 'TJSP', 'ativo',
     false, i.resp_b, 40000.00),
    (i.processo_b_sigiloso, i.escritorio_b, '20000000000000000002', 'TJSP',
     'ativo', true, i.resp_b, 50000.00);

  insert into partes (escritorio_id, processo_id, polo, qualificacao, nome,
                      documento, cliente_id) values
    (i.escritorio_a, i.processo_a, 'ativo', 'autor', 'Cliente do A',
     '11111111111', i.cliente_a),
    -- Parte adversa: cliente_id nulo. Confirma que a tabela guarda o polo
    -- contrário sem transformá-lo em cliente de ninguém.
    (i.escritorio_a, i.processo_a, 'passivo', 'reu', 'Empresa Adversa',
     '99999999999999', null),
    (i.escritorio_a, i.processo_a_sigiloso, 'ativo', 'autor', 'Cliente do A',
     '11111111111', i.cliente_a),
    (i.escritorio_a, i.processo_a_sem_portal, 'ativo', 'autor',
     'Cliente do A', '11111111111', i.cliente_a),
    (i.escritorio_b, i.processo_b, 'ativo', 'autor', 'Cliente do B',
     '22222222222', i.cliente_b),
    (i.escritorio_b, i.processo_b_sigiloso, 'ativo', 'autor', 'Cliente do B',
     '22222222222', i.cliente_b);

  insert into processos_equipe (escritorio_id, processo_id, usuario_id,
                               incluido_por) values
    (i.escritorio_a, i.processo_a, i.assoc_a, i.resp_a),
    (i.escritorio_b, i.processo_b, i.assoc_b, i.resp_b);

  insert into usuarios_portal (id, escritorio_id, cliente_id, nome, email,
                               criado_por) values
    (i.portal_a, i.escritorio_a, i.cliente_a, 'Portal A', 'cliente@a.com.br',
     i.resp_a),
    (i.portal_b, i.escritorio_b, i.cliente_b, 'Portal B', 'cliente@b.com.br',
     i.resp_b);

  insert into acessos_portal (escritorio_id, cliente_id, processo_id,
                              concedido_por) values
    (i.escritorio_a, i.cliente_a, i.processo_a, i.resp_a),
    -- Concessão para o processo sigiloso do A: o cliente é parte e tem
    -- direito de acompanhar. A prova é que nem assim ele lê por SELECT
    -- direto — a leitura tem que passar pela RPC que registra o acesso.
    (i.escritorio_a, i.cliente_a, i.processo_a_sigiloso, i.resp_a),
    (i.escritorio_b, i.cliente_b, i.processo_b, i.resp_b);
end;
$$;

-- Os testes leem cenario.ids já autenticados como usuário da aplicação, então
-- o schema precisa ser legível pelos roles do Supabase. É view de constantes:
-- não há dado de domínio aqui, e ela existe só dentro do banco de teste.
grant usage on schema cenario to anon, authenticated;
grant select on cenario.ids to anon, authenticated;
