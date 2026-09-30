-- ============================================================================
-- Portal do cliente final
-- ============================================================================
--
-- A policy mais delicada do sistema, e a que o briefing manda escrever com
-- cuidado redobrado. O erro aqui não é um escritório vendo outro: é uma pessoa
-- de fora do escritório vendo processo de terceiro, possivelmente sob segredo
-- de justiça.
--
-- A decisão de fundo: o acesso do portal é UMA LINHA CONCEDIDA, não uma
-- dedução. A alternativa natural seria "o cliente vê o processo em que existe
-- parte com o CPF dele", e ela é armadilha por três motivos:
--
--   1. Um dígito errado no CPF cadastrado pela secretaria concede acesso a
--      quem tiver aquele CPF. A falha é silenciosa dos dois lados.
--   2. Não existe revogação. Para tirar o acesso seria preciso alterar ou
--      apagar a parte do processo, que é dado processual, não permissão.
--   3. Não existe autor nem data. Em processo sigiloso, "quem autorizou este
--      acesso e quando" é pergunta que precisa de resposta.
--
-- Com concessão explícita a policy vira teste de existência de linha viva:
-- curta de ler, e testável pela negativa.
--
-- Simetria importante: as policies internas da migration anterior filtram por
-- `escritorio_id = app.escritorio_atual()`, e essa função devolve NULL para
-- quem é do portal. Comparação com NULL nega. Ou seja, o cliente final não
-- alcança `clientes`, `partes` nem `processos_equipe` por construção, sem
-- precisar de cláusula de exclusão em cada uma — e uma tabela de domínio nova
-- que siga a convenção nasce fechada para o portal.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- usuarios_portal
-- ----------------------------------------------------------------------------

-- Tabela separada de `usuarios`, e a razão é conter o dano. Se os dois
-- convivessem numa tabela com uma coluna de papel, um papel gravado errado —
-- por bug, por engano de cadastro, por escalada — daria ao cliente final
-- acesso interno ao escritório. Com universos disjuntos, o pior caso de um
-- defeito aqui é o cliente não ver nada, e o teste de isolamento verifica
-- justamente que nenhum id desta tabela responde às policies internas.
create table usuarios_portal (
  -- Mesma decisão de `usuarios`: a PK é o id do auth.users. Assim as policies
  -- do portal comparam direto com auth.uid(), sem join dentro de RLS.
  id uuid primary key references auth.users(id) on delete restrict,

  -- Redundante com clientes.escritorio_id, e aqui a redundância é necessária:
  -- é por esta coluna que a equipe interna administra os acessos do portal, e
  -- ela mantém a convenção que a suíte de isolamento exige de toda tabela de
  -- domínio. A coerência com o cliente é garantida por trigger.
  escritorio_id uuid not null references escritorios(id) on delete restrict,

  -- O login pertence a um cliente, não a um processo. Cliente pessoa jurídica
  -- costuma ter mais de uma pessoa acompanhando (o jurídico interno, o sócio),
  -- e cada uma precisa do próprio login — senha compartilhada é o que
  -- acontece quando o modelo não permite o segundo acesso.
  cliente_id uuid not null references clientes(id) on delete restrict,

  nome text not null check (length(trim(nome)) > 0),
  email citext not null,

  -- Desligamento imediato, sem depender de expiração de token. Mesmo motivo
  -- de usuarios.ativo: o cliente que encerra o contrato perde o acesso na
  -- consulta seguinte.
  ativo boolean not null default true,

  -- Quem criou o acesso. Em dado sigiloso, "quem deu esta senha" é pergunta
  -- com consequência.
  criado_por uuid references usuarios(id),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  excluido_em timestamptz,
  excluido_por uuid references usuarios(id),

  unique (cliente_id, email)
);

create index usuarios_portal_cliente_idx
  on usuarios_portal (cliente_id) where excluido_em is null;

-- ----------------------------------------------------------------------------
-- acessos_portal
-- ----------------------------------------------------------------------------

-- A concessão. Uma linha por (cliente, processo) que o escritório liberou.
create table acessos_portal (
  id uuid primary key default gen_random_uuid(),
  escritorio_id uuid not null references escritorios(id) on delete restrict,

  -- A concessão é para o CLIENTE, não para o usuário do portal. Se o cliente
  -- PJ trocar a pessoa que acompanha o caso, cria-se outro usuario_portal e a
  -- concessão continua valendo — o direito de acompanhar é do cliente, o login
  -- é de quem o exerce.
  cliente_id uuid not null references clientes(id) on delete restrict,
  processo_id uuid not null references processos(id) on delete restrict,

  concedido_por uuid not null references usuarios(id),
  concedido_em timestamptz not null default now(),

  -- Revogação por data, não por DELETE. A linha revogada é a prova de que o
  -- acesso existiu entre duas datas, e é isso que responde "quem podia ver
  -- este processo em março".
  revogado_por uuid references usuarios(id),
  revogado_em timestamptz,

  -- Por que o acesso foi concedido ou retirado. Texto livre, e opcional —
  -- exigir justificativa obrigatória produz "ok" em todas as linhas.
  observacao text,

  check (
    (revogado_em is null and revogado_por is null)
    or (revogado_em is not null and revogado_por is not null)
  )
);

-- Uma concessão viva por par. Índice parcial, para que revogar e conceder de
-- novo continue sendo possível — o histórico acumula, a concessão ativa é uma.
create unique index acessos_portal_unico_ativo
  on acessos_portal (cliente_id, processo_id)
  where revogado_em is null;

-- O caminho quente: resolver, a cada requisição do portal, quais processos o
-- cliente alcança.
create index acessos_portal_cliente_idx
  on acessos_portal (cliente_id) where revogado_em is null;

-- ----------------------------------------------------------------------------
-- Coerência
-- ----------------------------------------------------------------------------

create trigger usuarios_portal_atualizado_em before update on usuarios_portal
  for each row execute function app.tocar_atualizado_em();
create trigger usuarios_portal_escritorio_imutavel before update on usuarios_portal
  for each row execute function app.escritorio_id_imutavel();
create trigger acessos_portal_escritorio_imutavel before update on acessos_portal
  for each row execute function app.escritorio_id_imutavel();

create trigger usuarios_portal_tenant_cliente
  before insert or update on usuarios_portal
  for each row execute function app.coerencia_tenant_filho('cliente_id', 'clientes');
create trigger acessos_portal_tenant_cliente
  before insert or update on acessos_portal
  for each row execute function app.coerencia_tenant_filho('cliente_id', 'clientes');
create trigger acessos_portal_tenant_processo
  before insert or update on acessos_portal
  for each row execute function app.coerencia_tenant_filho('processo_id', 'processos');

-- Um login do portal nunca pode ser também um usuário interno. As duas
-- tabelas apontam para auth.users, e nada além deste trigger impediria a mesma
-- conta de existir nas duas — caso em que o portal passaria a enxergar o
-- escritório inteiro, porque escritorio_atual() responderia.
--
-- É a invariante que sustenta a separação das duas tabelas. Sem ela a
-- separação é convenção; com ela é garantia.
create or replace function app.identidade_exclusiva()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_table_name = 'usuarios_portal' then
    if exists (select 1 from public.usuarios u where u.id = new.id) then
      raise exception
        'a conta % já é usuário interno; equipe e portal não compartilham '
        'identidade', new.id
        using errcode = 'unique_violation';
    end if;
  else
    if exists (select 1 from public.usuarios_portal up where up.id = new.id) then
      raise exception
        'a conta % já é usuário do portal; equipe e portal não compartilham '
        'identidade', new.id
        using errcode = 'unique_violation';
    end if;
  end if;
  return new;
end;
$$;

create trigger usuarios_portal_identidade_exclusiva
  before insert or update on usuarios_portal
  for each row execute function app.identidade_exclusiva();
create trigger usuarios_identidade_exclusiva
  before insert or update on usuarios
  for each row execute function app.identidade_exclusiva();

-- Concessão só para processo em que o cliente realmente figura como parte.
--
-- Não substitui a concessão explícita — é a segunda trava, na direção
-- oposta. A concessão protege contra CPF errado conceder acesso sozinho;
-- este trigger protege contra a mão errada na tela de concessão, que é o
-- risco que a concessão manual introduz. Uma cobre o furo da outra.
--
-- O custo: a parte tem que estar cadastrada antes da concessão. É a ordem
-- natural do trabalho (cadastra-se o processo com as partes, depois libera o
-- portal), e a mensagem de erro diz o que fazer.
create or replace function app.acesso_portal_exige_parte()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.partes pa
     where pa.processo_id = new.processo_id
       and pa.cliente_id = new.cliente_id
       and pa.excluido_em is null
  ) then
    raise exception
      'o cliente % não figura como parte do processo %; cadastre a parte '
      'antes de liberar o portal', new.cliente_id, new.processo_id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger acessos_portal_exige_parte
  before insert on acessos_portal
  for each row execute function app.acesso_portal_exige_parte();

-- ----------------------------------------------------------------------------
-- Primitivas do portal
-- ----------------------------------------------------------------------------

-- Espelho de escritorio_atual() para o outro universo. Devolve NULL para
-- usuário interno, e é isso que faz as policies do portal negarem para a
-- equipe sem precisar de cláusula extra.
create or replace function app.cliente_portal_atual()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select up.cliente_id
    from public.usuarios_portal up
    join public.clientes c on c.id = up.cliente_id
   where up.id = auth.uid()
     and up.ativo
     and up.excluido_em is null
     -- Cliente desativado leva o acesso do portal com ele. Sem esta linha,
     -- encerrar o cliente deixaria o login dele funcionando.
     and c.excluido_em is null
$$;

create or replace function app.eh_portal()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.cliente_portal_atual() is not null
$$;

-- Os processos que o cliente do portal alcança.
--
-- Mesma forma de app.processos_atribuidos(): conjunto e não predicado, para
-- ser avaliado uma vez por statement. SECURITY DEFINER para não depender da
-- policy de acessos_portal — que, de propósito, não libera leitura para o
-- portal: o cliente vê os processos, não a tabela de permissões que os
-- concede.
create or replace function app.processos_do_portal()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select ap.processo_id
    from public.acessos_portal ap
   where ap.cliente_id = app.cliente_portal_atual()
     and ap.revogado_em is null
$$;

-- ----------------------------------------------------------------------------
-- Grants
-- ----------------------------------------------------------------------------

grant select, insert, update on usuarios_portal, acessos_portal to authenticated;

-- ----------------------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------------------

alter table usuarios_portal enable row level security;
alter table acessos_portal enable row level security;
alter table usuarios_portal force row level security;
alter table acessos_portal force row level security;

-- --- usuarios_portal ---

-- O cliente vê a própria linha, e só ela. Nem os outros logins do mesmo
-- cliente PJ: saber quem mais acompanha o caso não é necessário para
-- acompanhar o caso.
create policy usuarios_portal_leitura_propria on usuarios_portal
  for select to authenticated
  using (id = auth.uid() and excluido_em is null);

create policy usuarios_portal_leitura_interna on usuarios_portal
  for select to authenticated
  using (
    escritorio_id = app.escritorio_atual()
    and excluido_em is null
    and app.enxerga_escritorio_todo()
  );

-- Criar acesso de portal é ato de administração, não de cadastro. É o momento
-- em que dado sigiloso passa a sair do escritório.
create policy usuarios_portal_escrita_admin on usuarios_portal
  for insert to authenticated
  with check (escritorio_id = app.escritorio_atual() and app.eh_admin());

create policy usuarios_portal_atualizacao_admin on usuarios_portal
  for update to authenticated
  using (escritorio_id = app.escritorio_atual() and app.eh_admin())
  with check (escritorio_id = app.escritorio_atual());

-- O cliente corrige o próprio nome. Não tem UPDATE sobre `ativo` nem sobre
-- cliente_id — não por policy, que autoriza linha e não coluna, mas pelo
-- trigger abaixo.
create policy usuarios_portal_atualiza_se_mesmo on usuarios_portal
  for update to authenticated
  using (id = auth.uid() and excluido_em is null)
  with check (id = auth.uid());

create or replace function app.portal_bloquear_escalada()
returns trigger
language plpgsql
set search_path = 'public'
as $$
begin
  if app.eh_admin() then
    return new;
  end if;
  if new.cliente_id is distinct from old.cliente_id
     or new.ativo is distinct from old.ativo then
    raise exception
      'cliente_id e ativo em usuarios_portal só podem ser alterados por '
      'admin do escritório'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create trigger usuarios_portal_sem_escalada before update on usuarios_portal
  for each row execute function app.portal_bloquear_escalada();

-- --- acessos_portal ---

-- Só a equipe que enxerga o escritório todo lê e escreve. O cliente do portal
-- NÃO tem policy aqui, e é deliberado: ele chega aos processos pela função
-- SECURITY DEFINER, sem precisar ler a tabela de concessões. Menos superfície,
-- e nenhum ciclo entre esta policy e a de `processos`.
create policy acessos_portal_leitura_interna on acessos_portal
  for select to authenticated
  using (
    escritorio_id = app.escritorio_atual()
    and app.enxerga_escritorio_todo()
  );

create policy acessos_portal_concessao on acessos_portal
  for insert to authenticated
  with check (
    escritorio_id = app.escritorio_atual()
    and app.enxerga_escritorio_todo()
    -- Quem concede é quem está logado. Sem isto, seria possível registrar a
    -- concessão no nome de um colega, e a trilha de auditoria passaria a
    -- apontar para a pessoa errada.
    and concedido_por = auth.uid()
  );

create policy acessos_portal_revogacao on acessos_portal
  for update to authenticated
  using (
    escritorio_id = app.escritorio_atual()
    and app.enxerga_escritorio_todo()
  )
  with check (escritorio_id = app.escritorio_atual());

-- --- processos: o caminho do portal ---

-- Policy adicional, e não alteração da interna. Policies PERMISSIVE combinam
-- por OR, então esta acrescenta um caminho sem tocar no que já foi testado —
-- o que importa porque o caminho interno já tem prova escrita.
--
-- Processo sob segredo de justiça está fora aqui também. O cliente é parte e
-- tem direito de acompanhar, mas a leitura passa pela RPC que registra o
-- acesso (migration de auditoria): "todo acesso a processo sob sigilo fica
-- registrado" é critério de aceite, e vale para o acesso do cliente igual.
create policy processos_leitura_portal on processos
  for select to authenticated
  using (
    excluido_em is null
    and not segredo_justica
    and id in (select app.processos_do_portal())
  );

-- Não há policy de INSERT nem de UPDATE do portal em `processos`: o cliente
-- consulta o andamento, não altera o processo.

comment on table acessos_portal is
  'Concessão explícita de acesso do cliente final a um processo. É o que '
  'autoriza o portal — nunca o casamento de CPF em `partes`.';
