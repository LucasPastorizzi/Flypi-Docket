-- ============================================================================
-- Emulação mínima do ambiente Supabase, só para teste local e CI
-- ============================================================================
--
-- Este arquivo NÃO é migration e nunca roda em produção: no Supabase, tudo o
-- que está aqui já existe. Ele existe para que a suíte de isolamento rode num
-- Postgres nu, sem Docker — o que faz diferença em duas frentes: a máquina de
-- quem desenvolve não precisa de container só para provar uma policy, e o CI
-- roda com o serviço de Postgres que qualquer runner já oferece.
--
-- O que é emulado aqui é exatamente o contrato que as policies consomem:
-- os três roles do Supabase e auth.uid(). A implementação de auth.uid() abaixo
-- é a do Supabase — lê o JWT do parâmetro de sessão que o PostgREST preenche a
-- cada requisição —, e é por isso que os testes conseguem trocar de identidade
-- com set_config: é o mesmo mecanismo que o servidor real usa, não um atalho
-- de teste.
-- ============================================================================

create schema if not exists auth;

-- Espelho do auth.users do GoTrue, reduzido às colunas que o schema referencia.
-- As FKs das nossas tabelas apontam para cá, então a tabela precisa existir com
-- a PK certa; o resto do que o GoTrue guarda (senha, provedores, tokens) não
-- nos interessa e de propósito não está aqui.
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text
);

-- Os três roles do Supabase.
--   anon          — visitante não autenticado
--   authenticated — qualquer usuário logado, interno ou do portal
--   service_role  — a Edge Function; passa por cima do RLS por desenho
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    -- BYPASSRLS é o que torna service_role o caminho deliberado do servidor.
    -- Sem esta propriedade os testes de Edge Function passariam por acidente
    -- (por ser dono das tabelas) e não pelo motivo certo.
    create role service_role nologin noinherit bypassrls;
  end if;
end;
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant select on auth.users to authenticated, service_role;

-- Implementação do Supabase, reproduzida. Lê o `sub` do JWT que o PostgREST
-- injeta na sessão. Retorna NULL quando não há JWT, e as policies tratam NULL
-- como negação.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(
    coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    ),
    ''
  )::uuid
$$;

create or replace function auth.jwt()
returns jsonb
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb,
    '{}'::jsonb
  )
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )
$$;

-- ---------------------------------------------------------------------------
-- DEFAULT PRIVILEGES — a parte do ambiente Supabase que faltava
-- ---------------------------------------------------------------------------
--
-- Acrescentado depois de o schema ir para um projeto Supabase de verdade e a
-- anon key alcançar tabelas que, aqui, ela não alcançava. A causa: o Supabase
-- define ALTER DEFAULT PRIVILEGES concedendo acesso a anon, authenticated e
-- service_role em TODA tabela criada depois em `public`. Sem reproduzir isso,
-- a suíte afirmava uma proteção que o ambiente real não tinha.
--
-- É o caso exato que justifica emular o ambiente em vez de supor: o teste
-- estava certo sobre o que verificava e errado sobre onde ia rodar. Com as
-- linhas abaixo, qualquer tabela nova nasce com os grants que o Supabase dá —
-- e as migrations têm que revogar o que não querem, explicitamente, como
-- fariam em produção.
alter default privileges in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on functions to anon, authenticated, service_role;
