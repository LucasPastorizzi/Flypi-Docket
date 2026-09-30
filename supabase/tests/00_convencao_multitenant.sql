-- ============================================================================
-- Prova: a convenção multi-tenant vale para TODA tabela, inclusive as futuras
-- ============================================================================
--
-- Os outros dois arquivos provam o isolamento das tabelas que existem hoje.
-- Este prova a regra, varrendo o catálogo do Postgres — e é o que protege as
-- migrations que ainda não foram escritas.
--
-- A diferença importa. Um teste que enumera tabelas conhecidas passa
-- tranquilo no dia em que alguém acrescenta uma tabela sem RLS: ela não está
-- na lista, ninguém a testou, e o furo entra em produção com a suíte verde.
-- Aqui o padrão é o inverso: tabela nova é violação até que alguém a declare
-- exceção com motivo escrito, neste arquivo, e essa declaração aparece no
-- diff para ser discutida na revisão.
-- ============================================================================

begin;

select plan(7);

-- As únicas tabelas de `public` que podem não ter escritorio_id, com o motivo.
-- Acrescentar uma linha aqui é decisão de arquitetura, e é para doer um pouco.
--
-- Atenção ao que a exceção dispensa: SÓ a coluna escritorio_id. RLS, FORCE e a
-- existência de policy continuam exigidos de toda tabela nossa, exceção ou
-- não. A primeira versão deste arquivo dispensava a tabela isenta de todas as
-- verificações de uma vez, e assim a lista de exceções teria virado, com o
-- tempo, uma lista de tabelas sem isolamento nenhum.
create temporary view excecoes as
select * from (values
  ('escritorios',
   'é a raiz do tenant: a tabela não referencia escritório, ela É o '
   'escritório. A policy dela filtra por id = escritorio_atual()'),
  ('tribunais',
   'catálogo global: a sigla de um tribunal é a mesma para todos os '
   'escritórios, e é o que os feriados forenses referenciam'),
  ('feriados',
   'catálogo global curado pela Flypi: portaria do TJRS vale para todo '
   'escritório que atua no TJRS. Exceção local do escritório vai em '
   'feriados_escritorio, que TEM escritorio_id'),
  ('tipos_ato',
   'catálogo global de espécies de ato processual: "sentença" é sentença em '
   'qualquer escritório'),
  ('regras_prazo',
   'catálogo global de regras processuais, ratificado por advogado: o prazo '
   'do CPC não varia por escritório, e permitir que variasse seria permitir '
   'que um escritório calculasse prazo por conta própria com o nosso nome')
) as t(tabela, motivo);

-- Tudo em `public` que seja tabela nossa — inclusive as exceções acima.
create temporary view tabelas_nossas as
select c.relname::text as tabela, c.oid
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public'
   and c.relkind = 'r'
   -- Tabelas que vêm de extensão não são nossas.
   and not exists (
     select 1 from pg_depend d
      where d.objid = c.oid and d.deptype = 'e'
   );

create temporary view tabelas_dominio as
select tn.tabela, tn.oid
  from tabelas_nossas tn
 where not exists (select 1 from excecoes e where e.tabela = tn.tabela);

-- ----------------------------------------------------------------------------

select is_empty($$
  select td.tabela
    from tabelas_dominio td
   where not exists (
     select 1 from pg_attribute a
      where a.attrelid = td.oid
        and a.attname = 'escritorio_id'
        and a.attnum > 0
        and not a.attisdropped
   )
$$, 'toda tabela de domínio tem a coluna escritorio_id');

-- NOT NULL importa tanto quanto a coluna existir: escritorio_id nulo não
-- casa com nenhuma policy, então a linha fica invisível para a aplicação e
-- visível para service_role — um registro órfão que ninguém vê e ninguém
-- apaga.
select is_empty($$
  select td.tabela
    from tabelas_dominio td
    join pg_attribute a on a.attrelid = td.oid and a.attname = 'escritorio_id'
   where not a.attnotnull
$$, 'escritorio_id é NOT NULL em toda tabela de domínio');

select is_empty($$
  select tn.tabela
    from tabelas_nossas tn
    join pg_class c on c.oid = tn.oid
   where not c.relrowsecurity
$$, 'RLS está habilitado em toda tabela nossa, exceção declarada inclusive');

-- FORCE inclui o dono da tabela nas policies. Sem ele, qualquer conexão que
-- por acidente rode como dono — uma migration, um script de manutenção, uma
-- função SECURITY DEFINER escrita sem cuidado — enxerga todos os escritórios.
select is_empty($$
  select tn.tabela
    from tabelas_nossas tn
    join pg_class c on c.oid = tn.oid
   where not c.relforcerowsecurity
$$, 'FORCE ROW LEVEL SECURITY está ligado em toda tabela nossa');

-- RLS habilitado sem policy nenhuma nega tudo, o que é seguro mas é quase
-- certamente esquecimento — e o sintoma (tela vazia) manda investigar o lugar
-- errado.
select is_empty($$
  select tn.tabela
    from tabelas_nossas tn
   where not exists (select 1 from pg_policy p where p.polrelid = tn.oid)
$$, 'toda tabela nossa tem ao menos uma policy');

-- Segunda trava, independente do RLS: visitante não autenticado não tem
-- privilégio de tabela nenhum. Se uma policy futura for escrita errado, o
-- dado ainda não fica aberto para a internet — são duas camadas que erram
-- separado.
select is_empty($$
  select c.relname::text || ' -> ' || privilege_type as violacao
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   cross join lateral (
     select privilege_type
       from information_schema.table_privileges tp
      where tp.table_schema = 'public'
        and tp.table_name = c.relname
        and tp.grantee = 'anon'
   ) g(privilege_type)
   where n.nspname = 'public' and c.relkind = 'r'
$$, 'nenhuma tabela de public concede privilégio a anon');

-- Exclusão é lógica em todo o sistema, como o briefing exige. Não conceder
-- DELETE é mais confiável do que lembrar de não escrever DELETE: o que não
-- foi concedido não depende de disciplina.
select is_empty($$
  select tp.table_name::text
    from information_schema.table_privileges tp
   where tp.table_schema = 'public'
     and tp.privilege_type = 'DELETE'
     and tp.grantee in ('anon', 'authenticated')
$$, 'nenhuma tabela concede DELETE à aplicação: exclusão é lógica');

select * from finish();
rollback;
