-- ============================================================================
-- Flypi Docket — fundação: tenant, identidade da equipe e primitivas de RLS
-- ============================================================================
--
-- Esta é a primeira migration do sistema e ela já traz RLS ligado. O briefing
-- é explícito sobre isso, e a razão é operacional: acrescentar isolamento
-- depois, com dados reais de escritórios diferentes já dentro da mesma tabela,
-- é uma das migrações mais perigosas que existem — não há como testá-la sem
-- arriscar o dado que ela deveria proteger. Ligar RLS na tabela vazia custa
-- nada.
--
-- Convenção que vale para todo o schema: tabela de domínio tem
-- escritorio_id NOT NULL e RLS habilitado. A suíte de testes varre o catálogo
-- do Postgres e reprova qualquer tabela que fuja disso, de modo que uma tabela
-- nova mal configurada quebra o build em vez de virar vazamento silencioso.
-- ============================================================================

-- citext existe para e-mail. E-mail é case-insensitive na prática (o RFC
-- permite case-sensitivity na parte local, mas nenhum provedor real usa isso),
-- e guardar em text obrigaria todo lookup e todo índice único a lembrar de
-- lower() — um esquecimento cria dois usuários para a mesma pessoa.
create extension if not exists citext;

-- Schema separado para as funções de apoio das policies. Não é organização
-- estética: o Supabase expõe automaticamente por HTTP o que está em `public`,
-- e função de decisão de acesso não deve ser chamável pelo cliente. O que
-- mora em `app` fica fora da API.
create schema if not exists app;
revoke all on schema app from public;

-- ----------------------------------------------------------------------------
-- Domínios
-- ----------------------------------------------------------------------------

-- UF como domínio, não como enum: a lista é fechada na prática mas aparece em
-- muitas tabelas (OAB, feriado estadual, comarca), e domínio permite comparar
-- com text sem cast, o que enum não permite. A lista fica no check, visível.
create domain uf as char(2)
  check (value in (
    'AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT','PA',
    'PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO'
  ));

-- CPF/CNPJ guardado como dígitos, sem máscara. O check valida só o tamanho, e
-- isso é deliberado: dígito verificador em constraint fica ilegível e não
-- pode ser corrigido sem migration, então a validação de DV é da aplicação.
-- Não é numeric porque CPF tem zero à esquerda significativo — 012.345.678-90
-- virando 1234567890 é erro de cadastro que só aparece quando alguém tenta
-- casar com o dado do tribunal.
create domain documento_fiscal as text
  check (value ~ '^[0-9]{11}$' or value ~ '^[0-9]{14}$');

-- ----------------------------------------------------------------------------
-- Papéis
-- ----------------------------------------------------------------------------

-- Enum, não tabela: são os quatro perfis do briefing, o código faz decisão em
-- cima deles, e um papel novo é mudança de comportamento da aplicação — não é
-- dado que o escritório cadastra. Feriado e tipo de ato são o oposto disso, e
-- por isso vivem em tabela.
--
-- Note que admin_escritorio NÃO está aqui. Administrar o escritório (convidar
-- usuário, conceder acesso ao portal) é competência técnica, e o papel aqui é
-- competência processual. Misturar as duas obrigaria a secretaria a virar
-- advogada no sistema para poder cadastrar, ou o advogado a fazer cadastro.
create type papel_usuario as enum (
  'advogado_responsavel',  -- vê o escritório inteiro, confirma prazo, delega
  'advogado_associado',    -- vê os processos em que foi incluído
  'estagiario',            -- idem associado, sem poder de confirmar prazo
  'secretaria'             -- cadastra e organiza; não confirma prazo
);

-- ----------------------------------------------------------------------------
-- escritorios — a raiz do tenant
-- ----------------------------------------------------------------------------

-- É a única tabela de domínio sem escritorio_id, porque ela É o escritório.
create table escritorios (
  -- uuid e não bigint: id de escritório e de processo aparecem em URL,
  -- inclusive no portal do cliente final. Sequencial permite enumerar
  -- vizinhos e revela o volume de clientes da Flypi para qualquer um que
  -- receba um link. Não é a defesa principal — RLS é —, mas não custa nada.
  id uuid primary key default gen_random_uuid(),

  razao_social text not null check (length(trim(razao_social)) > 0),
  nome_fantasia text,

  -- CNPJ é único no sistema inteiro e serve de trava contra cadastro
  -- duplicado do mesmo escritório em dois planos. Nullable porque advogado
  -- autônomo pode não ter CNPJ, e o produto atende de 1 a 10 advogados.
  cnpj documento_fiscal unique,

  -- Seccional principal. Não substitui oabs_usuario: serve para escolher o
  -- calendário de feriados padrão do escritório sem precisar varrer as OABs
  -- de todo mundo a cada cálculo.
  uf_principal uf,

  ativo boolean not null default true,

  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),

  -- Exclusão lógica, como o briefing exige. Sem exclusão física em lugar
  -- nenhum: processo sob prazo é documento de defesa profissional do
  -- advogado, e DELETE não tem desfazer.
  excluido_em timestamptz,
  excluido_por uuid
);

comment on table escritorios is
  'Tenant. Toda tabela de domínio referencia esta por escritorio_id, e toda '
  'policy de RLS filtra por ela.';

-- ----------------------------------------------------------------------------
-- usuarios — a equipe interna
-- ----------------------------------------------------------------------------

-- Tabela separada de usuarios_portal (migration seguinte), e isso é decisão
-- de segurança, não de normalização. Se cliente final e equipe convivessem na
-- mesma tabela, um papel gravado errado por bug ou por engano de cadastro
-- viraria acesso interno ao escritório. Com dois universos disjuntos, o pior
-- caso de um bug na tabela do portal é o cliente não ver nada.
create table usuarios (
  -- PK é o id do auth.users do Supabase, não um id próprio. Um id próprio
  -- exigiria manter o mapeamento em sincronia, e todo lugar que hoje escreve
  -- `= auth.uid()` passaria a precisar de um join — dentro de policy de RLS,
  -- onde erro custa vazamento. O identificador de quem está logado e o
  -- identificador do perfil são a mesma coisa.
  id uuid primary key references auth.users(id) on delete restrict,

  -- RESTRICT e não CASCADE acima, de propósito: apagar a conta de
  -- autenticação não pode arrastar o histórico de quem confirmou qual prazo.
  -- Desligar alguém é `ativo = false` mais excluido_em; a linha fica.

  escritorio_id uuid not null references escritorios(id) on delete restrict,

  nome text not null check (length(trim(nome)) > 0),
  email citext not null,

  papel papel_usuario not null,

  -- Separado do papel, e acumulável. Ver o comentário do enum acima.
  admin_escritorio boolean not null default false,

  -- Desligamento imediato, sem mexer em auth.users. As policies checam isto,
  -- então tirar o acesso de alguém tem efeito na próxima consulta — que é
  -- justamente o motivo de o tenant ser resolvido por função e não por claim
  -- de JWT, que só expiraria depois.
  ativo boolean not null default true,

  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  excluido_em timestamptz,
  excluido_por uuid references usuarios(id),

  -- E-mail único dentro do escritório, não global: a mesma pessoa pode ser
  -- correspondente em dois escritórios clientes nossos, e nesse caso ela tem
  -- duas linhas aqui (foi a decisão de manter usuário 1:1 com escritório).
  unique (escritorio_id, email)
);

-- Índice para as policies: toda policy de toda tabela chama
-- escritorio_atual(), que resolve por esta PK. A PK já cobre o lookup.
-- Este índice serve para o caminho inverso — listar a equipe do escritório.
create index usuarios_escritorio_idx
  on usuarios (escritorio_id) where excluido_em is null;

-- ----------------------------------------------------------------------------
-- oabs_usuario — inscrições do advogado
-- ----------------------------------------------------------------------------

-- Tabela e não coluna, porque o briefing diz que um advogado pode ter
-- inscrição em mais de uma seccional. Não é caso raro a ignorar: é a chave de
-- busca no DJEN, e faltar uma seccional aqui significa publicação não
-- capturada, o que significa prazo perdido sem ninguém notar. O modo de
-- falhar é silencioso, então o modelo precisa acomodar o caso plural.
create table oabs_usuario (
  id uuid primary key default gen_random_uuid(),

  -- Redundante com usuarios.escritorio_id, e propositalmente. A policy desta
  -- tabela filtra pela própria coluna em vez de fazer join com usuarios: uma
  -- policy que depende de outra tabela depende também da policy daquela
  -- tabela, e essa composição é onde moram os erros difíceis de ver. A
  -- coerência entre as duas colunas é garantida por trigger, abaixo.
  escritorio_id uuid not null references escritorios(id) on delete restrict,
  usuario_id uuid not null references usuarios(id) on delete restrict,

  -- text e não integer: inscrição suplementar e de estagiário aparecem com
  -- sufixo em algumas seccionais, e o número é identificador, não quantidade
  -- — nunca vai entrar em conta aritmética.
  numero text not null check (numero ~ '^[0-9A-Za-z./-]{1,20}$'),
  seccional uf not null,

  -- Se a inscrição está valendo. Inscrição cancelada ou transferida não deve
  -- continuar sendo consultada no DJEN, mas também não pode ser apagada: as
  -- publicações já capturadas por ela continuam apontando para cá.
  ativa boolean not null default true,

  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  excluido_em timestamptz,
  excluido_por uuid references usuarios(id),

  -- A mesma inscrição não pode ser cadastrada duas vezes no mesmo escritório.
  -- Sem isso, a rotina diária consultaria a mesma OAB em duplicidade e
  -- gravaria a mesma publicação duas vezes — que é exatamente a duplicação de
  -- prazo que o critério de aceite proíbe.
  unique (escritorio_id, numero, seccional)
);

-- ----------------------------------------------------------------------------
-- Primitivas de RLS
-- ----------------------------------------------------------------------------

-- Toda policy do sistema resolve o tenant por aqui.
--
-- SECURITY DEFINER é o que impede recursão: a policy de `usuarios` precisa
-- saber o escritório do usuário, que está em `usuarios`. Rodando como dono,
-- a função não dispara RLS e a pergunta tem resposta.
--
-- STABLE permite ao planejador chamar uma vez por statement em vez de uma vez
-- por linha, e é correto porque o resultado não muda dentro da consulta.
--
-- search_path vazio é obrigatório em SECURITY DEFINER: sem isso, um schema
-- malicioso no search_path do chamador poderia sequestrar a resolução dos
-- nomes e a função responderia outro escritório. Por isso todo nome aqui é
-- qualificado.
create or replace function app.escritorio_atual()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select u.escritorio_id
    from public.usuarios u
   where u.id = auth.uid()
     and u.ativo
     and u.excluido_em is null
$$;

comment on function app.escritorio_atual() is
  'Escritório do usuário interno logado, ou NULL. NULL não é curinga: as '
  'policies comparam com = e a comparação com NULL resulta em NULL, que '
  'nega. Cliente do portal e usuário desativado caem nesse caso por '
  'construção, não por cláusula extra.';

create or replace function app.papel_atual()
returns papel_usuario
language sql
stable
security definer
set search_path = ''
as $$
  select u.papel
    from public.usuarios u
   where u.id = auth.uid()
     and u.ativo
     and u.excluido_em is null
$$;

-- Vê o escritório inteiro. O briefing separa "advogado responsável vê os
-- prazos do escritório" de "associado e estagiário veem só o que é deles", e
-- esta função é essa linha. Admin entra aqui porque quem concede acesso ao
-- portal precisa enxergar o que está concedendo.
create or replace function app.enxerga_escritorio_todo()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.usuarios u
     where u.id = auth.uid()
       and u.ativo
       and u.excluido_em is null
       and (u.papel in ('advogado_responsavel', 'secretaria')
            or u.admin_escritorio)
  )
$$;

comment on function app.enxerga_escritorio_todo() is
  'Verdadeiro para advogado responsável, secretaria e admin. A secretaria '
  'entra porque o briefing lhe dá o cadastro de processo e cliente, e não se '
  'cadastra o que não se vê.';

create or replace function app.eh_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.usuarios u
     where u.id = auth.uid()
       and u.ativo
       and u.excluido_em is null
       and u.admin_escritorio
  )
$$;

-- ----------------------------------------------------------------------------
-- Gatilhos de apoio
-- ----------------------------------------------------------------------------

create or replace function app.tocar_atualizado_em()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.atualizado_em := now();
  return new;
end;
$$;

create trigger escritorios_atualizado_em before update on escritorios
  for each row execute function app.tocar_atualizado_em();
create trigger usuarios_atualizado_em before update on usuarios
  for each row execute function app.tocar_atualizado_em();
create trigger oabs_usuario_atualizado_em before update on oabs_usuario
  for each row execute function app.tocar_atualizado_em();

-- Migrar um usuário de escritório é operação de suporte, com auditoria e
-- decisão humana — não é caminho de aplicação. Deixar a coluna mutável cria
-- um vetor em que um UPDATE mal filtrado transfere gente entre tenants, e a
-- policy de UPDATE não protege disso: ela autoriza a linha, não a coluna.
create or replace function app.escritorio_id_imutavel()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.escritorio_id is distinct from old.escritorio_id then
    raise exception
      'escritorio_id é imutável em %; mover registro entre escritórios é '
      'operação de suporte, não de aplicação', tg_table_name
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger usuarios_escritorio_imutavel before update on usuarios
  for each row execute function app.escritorio_id_imutavel();
create trigger oabs_usuario_escritorio_imutavel before update on oabs_usuario
  for each row execute function app.escritorio_id_imutavel();

-- RLS autoriza linhas, não colunas. Sem isto, a policy que deixa o usuário
-- corrigir o próprio nome também o deixaria promover a si mesmo a
-- advogado_responsavel com admin_escritorio — escalada de privilégio por
-- UPDATE em coluna própria.
create or replace function app.usuarios_bloquear_escalada()
returns trigger
language plpgsql
set search_path = 'public'
as $$
begin
  if app.eh_admin() then
    return new;
  end if;

  if new.papel is distinct from old.papel
     or new.admin_escritorio is distinct from old.admin_escritorio
     or new.ativo is distinct from old.ativo then
    raise exception
      'papel, admin_escritorio e ativo só podem ser alterados por admin do '
      'escritório'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create trigger usuarios_sem_escalada before update on usuarios
  for each row execute function app.usuarios_bloquear_escalada();

-- Mantém oabs_usuario.escritorio_id coerente com o do dono da inscrição. A
-- coluna é redundante para manter a policy simples (ver comentário na
-- tabela); a redundância só é segura se alguém garantir a coerência, e esse
-- alguém é o banco, não a aplicação.
create or replace function app.oab_coerente_com_usuario()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  escritorio_do_usuario uuid;
begin
  select u.escritorio_id into escritorio_do_usuario
    from public.usuarios u where u.id = new.usuario_id;

  if escritorio_do_usuario is distinct from new.escritorio_id then
    raise exception
      'OAB atribuída ao escritório % mas o usuário % pertence ao escritório %',
      new.escritorio_id, new.usuario_id, escritorio_do_usuario
      using errcode = 'foreign_key_violation';
  end if;
  return new;
end;
$$;

create trigger oabs_usuario_coerencia
  before insert or update on oabs_usuario
  for each row execute function app.oab_coerente_com_usuario();

-- ----------------------------------------------------------------------------
-- Grants — a camada antes do RLS
-- ----------------------------------------------------------------------------

-- RLS filtra linhas para quem já tem permissão na tabela. `anon` (visitante
-- não autenticado) não tem o que fazer em nenhuma tabela de domínio deste
-- sistema, nem lendo: negar no grant significa que um erro de policy no
-- futuro ainda não abre o dado para a internet. Duas travas independentes.
revoke all on all tables in schema public from anon;

grant usage on schema public to anon, authenticated;

grant select, insert, update on escritorios, usuarios, oabs_usuario
  to authenticated;

-- Sem DELETE para ninguém: exclusão é lógica em todo o sistema. Não conceder
-- é mais confiável que lembrar de não usar.

grant usage on schema app to authenticated;
grant execute on all functions in schema app to authenticated;

-- ----------------------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------------------

alter table escritorios enable row level security;
alter table usuarios enable row level security;
alter table oabs_usuario enable row level security;

-- FORCE inclui o dono da tabela nas policies. Sem isso, qualquer conexão que
-- por acidente rode como dono (uma migration, um script de manutenção, uma
-- função SECURITY DEFINER escrita sem cuidado) enxerga todos os escritórios.
-- service_role continua passando porque tem BYPASSRLS, e esse é o caminho
-- deliberado para a Edge Function — não um efeito colateral de propriedade.
alter table escritorios force row level security;
alter table usuarios force row level security;
alter table oabs_usuario force row level security;

-- --- escritorios ---

create policy escritorios_leitura_propria on escritorios
  for select to authenticated
  using (id = app.escritorio_atual() and excluido_em is null);

create policy escritorios_admin_atualiza on escritorios
  for update to authenticated
  using (id = app.escritorio_atual() and app.eh_admin() and excluido_em is null)
  with check (id = app.escritorio_atual());

-- Não há policy de INSERT em escritorios para authenticated, e é intencional:
-- criar escritório é contratar o SaaS. Passa pela Edge Function com
-- service_role, junto do primeiro admin, numa transação — um escritório sem
-- admin é um tenant órfão que ninguém consegue administrar.

-- --- usuarios ---

-- A equipe se enxerga: delegar tarefa e atribuir responsável exige listar os
-- colegas. O recorte é o escritório, e é o único recorte.
create policy usuarios_leitura_equipe on usuarios
  for select to authenticated
  using (escritorio_id = app.escritorio_atual() and excluido_em is null);

create policy usuarios_admin_insere on usuarios
  for insert to authenticated
  with check (escritorio_id = app.escritorio_atual() and app.eh_admin());

-- Duas policies de UPDATE em vez de uma com OR, porque PERMISSIVE combina por
-- OR de todo jeito e separado se lê melhor: dá para saber qual regra
-- autorizou. A escalada de privilégio por trás disto é barrada pelo trigger
-- usuarios_sem_escalada — policy não sabe restringir coluna.
create policy usuarios_atualiza_se_mesmo on usuarios
  for update to authenticated
  using (id = auth.uid() and excluido_em is null)
  with check (id = auth.uid());

create policy usuarios_admin_atualiza on usuarios
  for update to authenticated
  using (escritorio_id = app.escritorio_atual() and app.eh_admin())
  with check (escritorio_id = app.escritorio_atual());

-- --- oabs_usuario ---

create policy oabs_leitura_equipe on oabs_usuario
  for select to authenticated
  using (escritorio_id = app.escritorio_atual() and excluido_em is null);

-- Admin cadastra a OAB de qualquer um; o advogado cadastra a própria. A OAB
-- alimenta a busca de publicações, então errá-la é deixar de capturar
-- publicação — o titular é quem sabe conferir o próprio número.
create policy oabs_admin_escreve on oabs_usuario
  for insert to authenticated
  with check (
    escritorio_id = app.escritorio_atual()
    and (app.eh_admin() or usuario_id = auth.uid())
  );

create policy oabs_admin_atualiza on oabs_usuario
  for update to authenticated
  using (
    escritorio_id = app.escritorio_atual()
    and (app.eh_admin() or usuario_id = auth.uid())
  )
  with check (escritorio_id = app.escritorio_atual());
