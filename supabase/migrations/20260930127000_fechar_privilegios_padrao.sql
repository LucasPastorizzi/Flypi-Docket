-- ============================================================================
-- Fechar os privilégios que o Supabase concede por padrão
-- ============================================================================
--
-- Esta migration existe por causa de um erro encontrado ao subir o schema num
-- projeto Supabase de verdade, e vale registrar como foi descoberto: a suíte
-- passava, o banco local negava tudo para `anon`, e no projeto real a anon key
-- alcançava `processos`, `clientes`, `prazos` e `auditoria`.
--
-- A causa é um comportamento do Supabase que o ambiente de teste não
-- reproduzia: ele define
--
--   ALTER DEFAULT PRIVILEGES IN SCHEMA public
--     GRANT ALL ON TABLES TO anon, authenticated, service_role;
--
-- de modo que TODA tabela criada depois nasce com todos os privilégios para os
-- três roles — inclusive DELETE, e inclusive para o visitante não autenticado.
-- `REVOKE ALL ... FROM anon` numa migration anterior não adianta: ele age sobre
-- as tabelas que existem naquele instante, e as seguintes voltam a nascer
-- abertas.
--
-- O que NÃO estava vazando, e por quê: o RLS continuou negando, porque as
-- policies são todas `TO authenticated` e não há policy de DELETE em tabela
-- nenhuma. O dado não saiu. O que se perdeu foi a segunda camada — a ideia de
-- que um erro futuro numa policy encontraria um privilégio ausente pela frente
-- em vez de passagem livre. Num sistema com processo em segredo de justiça,
-- essa camada é a diferença entre um bug e um incidente.
--
-- O ambiente de teste foi corrigido junto, e é a parte que importa mais a
-- longo prazo: o shim agora aplica os mesmos default privileges, então a
-- suíte reprova sozinha quem esquecer disso na próxima tabela.
-- ============================================================================

-- 1. O futuro: tabela nova para de nascer aberta.
--
-- `FOR ROLE postgres` porque é o dono que cria as tabelas nas migrations, e
-- default privileges pertencem a um role específico — revogar sem nomear
-- mexeria nos defaults do role que está rodando a migration, que pode ser
-- outro, e o efeito seria nenhum.
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on functions from anon;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;

alter default privileges for role postgres in schema app
  revoke all on functions from anon, authenticated;

-- 2. O presente: tira tudo o que já foi concedido automaticamente.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema app from anon, authenticated;

-- 3. Reconcede, explicitamente, só o que cada tabela precisa.
--
-- A lista é repetida aqui de propósito, em vez de "reconceder o que havia":
-- depois de um REVOKE ALL, a única forma de saber o que o sistema precisa é
-- alguém declarar. E declarada num lugar só, ela vira o inventário de
-- privilégios do produto — dá para ler esta seção e saber exatamente o que a
-- aplicação pode fazer em cada tabela.
--
-- DELETE não aparece em lugar nenhum, e é o ponto: exclusão é lógica em todo
-- o sistema. O que não foi concedido não depende de ninguém lembrar de não
-- escrever DELETE.

grant usage on schema public to anon, authenticated;
grant usage on schema app to authenticated;

-- Tenant e identidade
grant select, insert, update on escritorios, usuarios, oabs_usuario
  to authenticated;

-- Domínio
grant select, insert, update on clientes, processos, partes, processos_equipe
  to authenticated;
grant select, insert, update on usuarios_portal, acessos_portal
  to authenticated;
grant select, insert, update on publicacoes, prazos, tarefas to authenticated;
grant select, insert, update on documentos to authenticated;
grant select, insert, update on feriados_escritorio to authenticated;
grant select, insert, update on solicitacoes_titular to authenticated;

-- Catálogos globais: leitura apenas. Escrita é da Flypi, por service_role.
grant select on tribunais, feriados, tipos_ato, regras_prazo,
                finalidades_tratamento to authenticated;

-- Auditoria: leitura filtrada por policy, e nada de escrita. Todo registro
-- passa por app.registrar(), chamada pelas funções SECURITY DEFINER.
grant select on auditoria to authenticated;

-- Funções de apoio das policies. Respondem só sobre o próprio chamador e não
-- têm efeito colateral.
grant execute on function
  app.escritorio_atual(), app.papel_atual(), app.enxerga_escritorio_todo(),
  app.eh_admin(), app.processos_atribuidos(), app.cliente_portal_atual(),
  app.eh_portal(), app.processos_do_portal(), app.pode_ver_processo(uuid)
  to authenticated;

-- A leitura auditada de processo.
grant execute on function public.ver_processo(uuid) to authenticated;

-- app.registrar() continua fora do alcance da aplicação: com acesso a ela,
-- qualquer cliente autenticado escreveria na trilha o ator que quisesse.

-- 4. `anon` não recebe nada. Ele existe para a tela de login e para o fluxo de
-- recuperação de senha, que vivem no schema `auth` e não aqui.
