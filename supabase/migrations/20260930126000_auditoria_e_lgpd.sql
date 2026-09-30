-- ============================================================================
-- Auditoria, leitura auditada de processo sigiloso, e LGPD
-- ============================================================================
--
-- "Todo acesso a processo sob sigilo fica registrado" é critério de aceite, e
-- cumpri-lo tem um obstáculo concreto: o Postgres não tem trigger de SELECT.
-- Não existe forma de o banco reagir a uma leitura.
--
-- A saída escolhida, e ratificada antes de escrever isto: processo sigiloso
-- NÃO é legível por SELECT direto — as policies já o excluem desde a migration
-- de domínio —, e a leitura passa por uma função que grava o acesso e devolve
-- a linha. O log deixa de depender de a aplicação lembrar de registrar.
--
-- A alternativa era registrar na aplicação e deixar o SELECT livre. Rejeitada
-- porque o que ela protege é o caminho felizardo: um bug no front, um cliente
-- alternativo, um script de suporte ou uma consulta pelo painel do Supabase
-- leriam o processo sem deixar rastro — e é exatamente nesses casos que a
-- pergunta "quem viu?" é feita.
--
-- Custo, registrado por honestidade: a aplicação tem dois caminhos de leitura,
-- e a regra de quem pode ver um processo passa a existir em dois lugares — na
-- policy e nesta função. É a única duplicação deliberada do schema, e ela é
-- mantida em acordo por teste, não por atenção: a suíte compara, para cada
-- usuário, o conjunto que a policy entrega com o que esta função autoriza.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- auditoria
-- ----------------------------------------------------------------------------

create type ator_auditoria as enum (
  'equipe',    -- usuario interno
  'portal',    -- cliente final
  'servico'    -- Edge Function com service_role
);

create type acao_auditoria as enum (
  'leitura',
  'criacao',
  'alteracao',
  'exclusao_logica',
  'concessao_portal',
  'revogacao_portal',
  'exportacao'
);

create table auditoria (
  -- bigint identity e não uuid: é a tabela de maior volume do sistema, e a
  -- ordem de inserção é informação útil aqui (a sequência dos acessos). O
  -- argumento contra sequencial — enumeração por URL — não se aplica: id de
  -- auditoria não vai para URL nenhuma.
  id bigint primary key generated always as identity,

  escritorio_id uuid not null references escritorios(id) on delete restrict,

  -- Sem FK, e de propósito. O ator pode ser um usuário interno, um login de
  -- portal, ou nenhum dos dois (service_role). Uma FK obrigaria a escolher uma
  -- das tabelas, e duas colunas de FK mutuamente exclusivas ficariam metade
  -- nulas em metade das linhas. Mais importante: a auditoria tem que sobreviver
  -- ao ator — se a conta for removida algum dia, o registro de quem acessou o
  -- processo sigiloso continua valendo, e a FK o impediria ou o arrastaria.
  ator_id uuid,
  ator_tipo ator_auditoria not null,

  acao acao_auditoria not null,

  entidade text not null,
  registro_id uuid,

  -- Desnormalizado de propósito. A pergunta que esta tabela existe para
  -- responder é "quem acessou este processo sigiloso, e quando" — com o
  -- processo só dentro do jsonb, responder exigiria varredura. Aqui é índice.
  processo_id uuid,

  dados_antes jsonb,
  dados_depois jsonb,

  -- inet e não text: é o tipo certo, valida o formato e permite consultar por
  -- faixa, que é o que se faz quando se investiga acesso suspeito.
  ip inet,
  user_agent text,

  ocorrido_em timestamptz not null default now()
);

create index auditoria_processo_idx
  on auditoria (processo_id, ocorrido_em desc) where processo_id is not null;
create index auditoria_ator_idx on auditoria (ator_id, ocorrido_em desc);
create index auditoria_escritorio_idx on auditoria (escritorio_id, ocorrido_em desc);

comment on table auditoria is
  'Append-only. UPDATE e DELETE são revogados de todos os roles da aplicação: '
  'registro de acesso que pode ser alterado não é registro de acesso.';

-- ----------------------------------------------------------------------------
-- Registro
-- ----------------------------------------------------------------------------

-- Converte o x-forwarded-for num inet, ou devolve NULL.
--
-- O cabeçalho vem como lista quando há proxy no caminho ("cliente, proxy1,
-- proxy2"), e pode vir malformado, então o cast direto falha em runtime. Onde
-- essa falha aconteceria é o problema: dentro da função de auditoria, que roda
-- dentro da leitura — um cabeçalho estranho derrubaria a leitura do processo.
--
-- A escolha, então: IP inválido grava NULL e a linha de auditoria entra. Perder
-- o endereço é ruim; perder o registro inteiro do acesso a um processo
-- sigiloso é pior, e negar a leitura por causa de um cabeçalho é pior ainda.
create or replace function app.primeiro_ip(p_cabecalho text)
returns inet
language plpgsql
immutable
set search_path = ''
as $$
begin
  return split_part(p_cabecalho, ',', 1)::inet;
exception when others then
  return null;
end;
$$;

-- A aplicação NÃO tem INSERT direto em auditoria — ver os grants abaixo. Todo
-- registro passa por aqui, e é esta função que decide escritorio_id e
-- ator_tipo a partir do contexto de autenticação.
--
-- O motivo de não conceder INSERT: com privilégio direto, qualquer cliente
-- autenticado poderia gravar linha de auditoria com o ator que quisesse. Log
-- forjável tem valor negativo — dá a impressão de trilha onde não há.
create or replace function app.registrar(
  p_acao acao_auditoria,
  p_entidade text,
  p_registro_id uuid default null,
  p_processo_id uuid default null,
  p_escritorio_id uuid default null,
  p_dados_antes jsonb default null,
  p_dados_depois jsonb default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_escritorio uuid;
  v_tipo public.ator_auditoria;
  v_cliente uuid;
begin
  -- O ator: de onde vem a identidade de quem agiu.
  if app.escritorio_atual() is not null then
    v_tipo := 'equipe';
  elsif app.cliente_portal_atual() is not null then
    v_tipo := 'portal';
  else
    -- Nem equipe nem portal: é a Edge Function com service_role, que não tem
    -- auth.uid().
    v_tipo := 'servico';
  end if;

  -- O escritório da LINHA de auditoria é o do DADO acessado, não o do ator.
  --
  -- A distinção só aparece num caso, e é o caso que importa: alguém do
  -- escritório A tentando ler processo sigiloso do escritório B. Gravar essa
  -- tentativa na trilha de A a deixaria invisível para B — que é quem tem o
  -- dever de guarda sobre aquele processo e quem vai fazer a pergunta "quem
  -- tentou acessar isto?". Quem chama passa o escritório do dado; sem
  -- parâmetro, cai no do ator, que é o caso normal em que os dois coincidem.
  v_escritorio := coalesce(p_escritorio_id, app.escritorio_atual());

  if v_escritorio is null and v_tipo = 'portal' then
    select up.escritorio_id into v_escritorio
      from public.usuarios_portal up where up.id = auth.uid();
  end if;

  if v_escritorio is null then
    raise exception
      'não há escritório para registrar auditoria: chamada sem identidade e '
      'sem p_escritorio_id'
      using errcode = 'null_value_not_allowed';
  end if;

  insert into public.auditoria (
    escritorio_id, ator_id, ator_tipo, acao, entidade, registro_id,
    processo_id, dados_antes, dados_depois, ip, user_agent
  ) values (
    v_escritorio, auth.uid(), v_tipo, p_acao, p_entidade, p_registro_id,
    p_processo_id, p_dados_antes, p_dados_depois,
    -- Vêm dos cabeçalhos que o PostgREST expõe. NULL quando a chamada não é
    -- HTTP (rotina, migration, console), e NULL aqui é informação: significa
    -- que o acesso não veio do navegador de ninguém.
    app.primeiro_ip(
      nullif(current_setting('request.headers', true), '')::jsonb
        ->> 'x-forwarded-for'
    ),
    nullif(current_setting('request.headers', true), '')::jsonb
      ->> 'user-agent'
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- A regra de visibilidade, na forma que a RPC precisa
-- ----------------------------------------------------------------------------

-- Esta é a segunda cópia da regra de quem pode ver um processo — a primeira
-- são as policies de `processos`. A duplicação é inevitável: a policy não pode
-- ser consultada como predicado, e a RPC é SECURITY DEFINER e portanto não
-- passa por ela.
--
-- A diferença em relação à policy, e é a razão de a função existir: aqui o
-- sigilo NÃO exclui. Processo sigiloso é visível por este caminho justamente
-- porque este caminho registra.
--
-- Mantida em acordo com a policy por teste, no arquivo de auditoria da suíte:
-- para cada usuário do cenário, o conjunto de processos não sigilosos que a
-- policy entrega tem que ser igual ao que esta função autoriza. Divergência
-- reprova o build.
create or replace function app.pode_ver_processo(p_processo uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    -- Caminho interno
    select 1
      from public.processos p
     where p.id = p_processo
       and p.excluido_em is null
       and p.escritorio_id = app.escritorio_atual()
       and (
         app.enxerga_escritorio_todo()
         or p.advogado_responsavel_id = auth.uid()
         or p.id in (select app.processos_atribuidos())
       )
  ) or exists (
    -- Caminho do portal: concessão viva
    select 1
      from public.processos p
     where p.id = p_processo
       and p.excluido_em is null
       and p.id in (select app.processos_do_portal())
  )
$$;

-- ----------------------------------------------------------------------------
-- ver_processo — a leitura auditada
-- ----------------------------------------------------------------------------

-- O único caminho de leitura de processo em segredo de justiça, para equipe e
-- para portal.
--
-- Não autorizado devolve ZERO LINHAS, e não erro. Erro distinguiria "não pode
-- ver" de "não existe", e essa distinção é ela mesma um vazamento: quem sonda
-- ids descobriria quais existem.
--
-- A tentativa não autorizada também é registrada. Acesso negado a processo
-- sigiloso é o evento que mais interessa em investigação, e não registrá-lo
-- deixaria a trilha com só as leituras bem-sucedidas.
create or replace function public.ver_processo(p_processo uuid)
returns setof processos
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sigiloso boolean;
  v_escritorio uuid;
begin
  select p.segredo_justica, p.escritorio_id
    into v_sigiloso, v_escritorio
    from public.processos p
   where p.id = p_processo and p.excluido_em is null;

  if not found then
    -- Id inexistente: nada a registrar e nada a devolver. Registrar aqui
    -- encheria a auditoria com ruído de id digitado errado.
    return;
  end if;

  if not app.pode_ver_processo(p_processo) then
    if v_sigiloso then
      perform app.registrar(
        'leitura', 'processos', p_processo, p_processo, v_escritorio,
        null, '{"resultado": "negado"}'::jsonb
      );
    end if;
    return;
  end if;

  -- Registra toda leitura por este caminho, não só a de processo sigiloso.
  -- Para o não sigiloso a aplicação usa SELECT direto, então quem chega aqui
  -- está pedindo o caminho auditado — e filtrar por sigilo faria a trilha
  -- depender de um flag que pode mudar depois do acesso.
  perform app.registrar(
    'leitura', 'processos', p_processo, p_processo, v_escritorio,
    null,
    jsonb_build_object('resultado', 'permitido', 'sigiloso', v_sigiloso)
  );

  return query
    select p.* from public.processos p where p.id = p_processo;
end;
$$;

comment on function public.ver_processo(uuid) is
  'Leitura auditada de processo. É o ÚNICO caminho para processo em segredo de '
  'justiça, porque o Postgres não tem trigger de SELECT e o log precisa ser '
  'garantia e não boa intenção. Devolve zero linhas quando não autorizado, '
  'nunca erro: erro distinguiria "não pode" de "não existe".';

-- ----------------------------------------------------------------------------
-- LGPD
-- ----------------------------------------------------------------------------

-- Base legal declarada por finalidade, como o briefing exige. Catálogo global:
-- a base legal para tratar dado de processo judicial é a mesma para todos os
-- escritórios, e deixar cada um declarar a sua produziria declarações
-- divergentes sobre o mesmo tratamento — feito pelo mesmo software, nosso.
create table finalidades_tratamento (
  codigo text primary key check (codigo ~ '^[a-z0-9_]{3,60}$'),
  nome text not null,
  descricao text not null,

  -- As hipóteses do art. 7º da LGPD que se aplicam a este produto. A lista não
  -- é a íntegra do artigo: são as que a Flypi declara usar, e acrescentar uma
  -- é decisão que precisa de revisão jurídica, não de migration.
  base_legal text not null check (base_legal in (
    'execucao_de_contrato',
    'obrigacao_legal',
    'exercicio_regular_de_direitos',
    'legitimo_interesse',
    'consentimento'
  )),

  -- Prazo de descarte, que o briefing pede explicitamente. Em meses e não em
  -- data: é uma política ("cinco anos depois do encerramento"), não um dia.
  -- NULL significa retenção sem prazo definido, e é caso a justificar — não o
  -- default confortável.
  prazo_descarte_meses integer check (
    prazo_descarte_meses is null or prazo_descarte_meses > 0
  ),
  justificativa_retencao text,

  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),

  check (prazo_descarte_meses is not null or justificativa_retencao is not null)
);

-- O canal do art. 18 da LGPD. Existe como tabela porque pedido de titular tem
-- prazo de resposta, e prazo sem registro é prazo perdido — que é o mesmo
-- raciocínio do resto do sistema, aplicado a nós mesmos.
create table solicitacoes_titular (
  id uuid primary key default gen_random_uuid(),
  escritorio_id uuid not null references escritorios(id) on delete restrict,

  tipo text not null check (tipo in (
    'acesso', 'correcao', 'exclusao', 'portabilidade', 'revogacao_consentimento'
  )),

  -- O titular pode ser cliente cadastrado ou não: parte adversa, testemunha e
  -- ex-cliente também são titulares de dado que está aqui, e nenhum deles tem
  -- linha em `clientes`. Por isso o vínculo é opcional e a identificação
  -- textual é obrigatória.
  cliente_id uuid references clientes(id) on delete restrict,
  titular_nome text not null,
  titular_documento documento_fiscal,
  titular_contato text not null,

  recebido_em timestamptz not null default now(),

  -- date: é um dia de vencimento, como qualquer prazo deste sistema.
  prazo_resposta date not null,

  status text not null default 'aberta' check (status in (
    'aberta', 'em_analise', 'atendida', 'recusada'
  )),

  -- Recusa exige motivo. Pedido de exclusão colide com dever de guarda de
  -- documento processual, e essa é recusa legítima — mas tem que estar
  -- escrita, porque é ela que se apresenta se o titular questionar.
  resposta text,
  respondido_em timestamptz,
  respondido_por uuid references usuarios(id),

  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),

  constraint resposta_coerente check (
    (status in ('atendida', 'recusada'))
    = (respondido_em is not null and resposta is not null)
  )
);

create index solicitacoes_titular_prazo_idx
  on solicitacoes_titular (escritorio_id, prazo_resposta)
  where status in ('aberta', 'em_analise');

-- ----------------------------------------------------------------------------
-- Triggers
-- ----------------------------------------------------------------------------

create trigger finalidades_atualizado_em before update on finalidades_tratamento
  for each row execute function app.tocar_atualizado_em();
create trigger solicitacoes_titular_atualizado_em before update on solicitacoes_titular
  for each row execute function app.tocar_atualizado_em();
create trigger solicitacoes_titular_escritorio_imutavel before update on solicitacoes_titular
  for each row execute function app.escritorio_id_imutavel();
create trigger solicitacoes_titular_tenant_cliente
  before insert or update on solicitacoes_titular
  for each row execute function app.coerencia_tenant_filho('cliente_id', 'clientes');

-- ----------------------------------------------------------------------------
-- Grants
-- ----------------------------------------------------------------------------

-- Auditoria: SELECT restrito por policy, e NADA de INSERT. Todo registro passa
-- por app.registrar(), que decide o ator a partir do contexto — com INSERT
-- direto, um cliente autenticado gravaria linha com o ator que quisesse, e log
-- forjável é pior que log ausente.
grant select on auditoria to authenticated;

-- Append-only explícito. O REVOKE é redundante com nunca ter concedido, e fica
-- como declaração de intenção para quem for conceder algo aqui no futuro.
revoke update, delete on auditoria from authenticated, anon;

grant select on finalidades_tratamento to authenticated;
grant select, insert, update on solicitacoes_titular to authenticated;

grant execute on function public.ver_processo(uuid) to authenticated;

-- app.registrar() NÃO é chamável pela aplicação.
--
-- O Postgres concede EXECUTE a PUBLIC em toda função nova por padrão, então
-- não conceder não basta — é preciso revogar. Sem isto, qualquer cliente
-- autenticado chamaria a função de registro direto e escreveria na auditoria
-- o que quisesse, inclusive em nome de outro escritório. Log forjável é pior
-- que log ausente: dá a impressão de trilha onde não há.
--
-- Quem chama é ver_processo(), que é SECURITY DEFINER e portanto roda como
-- dono. As outras funções de `app` continuam executáveis porque só respondem
-- sobre o próprio chamador e não têm efeito colateral — chamá-las não produz
-- nada que já não estivesse disponível.
revoke execute on function app.registrar(
  acao_auditoria, text, uuid, uuid, uuid, jsonb, jsonb
) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------------------

alter table auditoria enable row level security;
alter table finalidades_tratamento enable row level security;
alter table solicitacoes_titular enable row level security;
alter table auditoria force row level security;
alter table finalidades_tratamento force row level security;
alter table solicitacoes_titular force row level security;

-- Quem lê a trilha é quem responde pelo escritório. Não é dado de operação
-- diária: é o registro de quem viu o que, e ele expõe o comportamento de cada
-- membro da equipe.
create policy auditoria_leitura_responsavel on auditoria
  for select to authenticated
  using (
    escritorio_id = app.escritorio_atual()
    and (app.eh_admin() or app.papel_atual() = 'advogado_responsavel')
  );

create policy finalidades_leitura on finalidades_tratamento
  for select to authenticated using (true);

-- Pedido de titular é tratado por quem administra. Envolve decidir sobre
-- exclusão de dado, que colide com dever de guarda — não é triagem de
-- secretaria.
create policy solicitacoes_titular_gestao on solicitacoes_titular
  for select to authenticated
  using (
    escritorio_id = app.escritorio_atual()
    and (app.eh_admin() or app.papel_atual() = 'advogado_responsavel')
  );

create policy solicitacoes_titular_registro on solicitacoes_titular
  for insert to authenticated
  with check (
    escritorio_id = app.escritorio_atual()
    and app.enxerga_escritorio_todo()
  );

create policy solicitacoes_titular_atualizacao on solicitacoes_titular
  for update to authenticated
  using (
    escritorio_id = app.escritorio_atual()
    and (app.eh_admin() or app.papel_atual() = 'advogado_responsavel')
  )
  with check (escritorio_id = app.escritorio_atual());
