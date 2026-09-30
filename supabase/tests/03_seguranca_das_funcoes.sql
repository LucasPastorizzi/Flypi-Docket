-- ============================================================================
-- Prova: nenhuma função SECURITY DEFINER com search_path aberto
-- ============================================================================
--
-- Este schema usa SECURITY DEFINER em dois lugares — nas primitivas que as
-- policies consultam e nos triggers de integridade —, e em ambos por motivo
-- justificado. O preço disso é uma armadilha específica: função SECURITY
-- DEFINER sem search_path fixo resolve nomes pelo search_path de QUEM CHAMA.
--
-- O ataque é direto. Quem consegue criar objeto num schema que esteja no
-- search_path cria uma tabela `usuarios` própria, chama uma operação que
-- dispare a função, e ela passa a ler a tabela falsa — respondendo o
-- escritório que o atacante escolheu. É elevação de privilégio dentro do
-- mecanismo que decide o acesso.
--
-- A trava é `set search_path = ''` com todo nome qualificado. Como é fácil
-- esquecer numa função nova, a regra é verificada no catálogo e não na
-- revisão de código.
-- ============================================================================

begin;

select plan(2);

select is_empty($$
  select n.nspname || '.' || p.proname as funcao
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'app')
     and p.prosecdef
     and not exists (
       select 1 from unnest(coalesce(p.proconfig, array[]::text[])) cfg
        where cfg like 'search\_path=%'
     )
     and not exists (
       select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e'
     )
$$, 'toda função SECURITY DEFINER declara search_path');

-- Vazio e não 'public': com 'public' no search_path a função ainda resolve
-- nomes numa tabela que um schema mais à frente possa sombrear, e a
-- qualificação explícita deixa de ser obrigatória — o que faz a próxima
-- função nascer sem ela.
select is_empty($$
  select n.nspname || '.' || p.proname || ' -> ' || cfg as funcao
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   cross join lateral unnest(coalesce(p.proconfig, array[]::text[])) cfg
   where n.nspname in ('public', 'app')
     and p.prosecdef
     and cfg like 'search\_path=%'
     and cfg not in ('search_path=', 'search_path=""')
     and not exists (
       select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e'
     )
$$, 'o search_path das funções SECURITY DEFINER é vazio, não "public"');

select * from finish();
rollback;
