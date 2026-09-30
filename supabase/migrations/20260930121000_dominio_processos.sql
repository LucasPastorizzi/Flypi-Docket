-- ============================================================================
-- Domínio interno: tribunais, clientes, processos, partes e equipe do caso
-- ============================================================================
--
-- Decisão central desta migration: existe UM lugar que define quem pode ver um
-- processo — a policy de `processos`. As tabelas filhas (partes, e mais tarde
-- prazos, tarefas, documentos, publicações) não repetem a regra; elas
-- perguntam "o processo é visível?" com um EXISTS sobre `processos`, e o RLS
-- de `processos` é aplicado dentro dessa subconsulta. A regra de visibilidade
-- fica escrita uma vez.
--
-- Isso contraria de propósito o que fiz em oabs_usuario, onde duplicei
-- escritorio_id justamente para não depender da policy de outra tabela. A
-- diferença é semântica: lá a dependência seria acidental, e a coerência entre
-- as duas colunas é invariante que o banco garante por trigger. Aqui a
-- dependência É a regra de negócio — "vejo a parte porque vejo o processo" —,
-- e duplicá-la significaria manter duas cópias de uma regra que vai mudar.
-- Duas cópias divergem, e a que divergir para o lado permissivo é vazamento.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- tribunais — catálogo global
-- ----------------------------------------------------------------------------

-- Sem escritorio_id, e é uma das poucas exceções conscientes à regra: TJRS é
-- TJRS para todo mundo. O que motiva a tabela é o calendário — feriado
-- forense varia por tribunal, sai por portaria, e precisa de algo estável para
-- referenciar. Sigla solta em coluna text de `processos` produziria 'TJ-RS',
-- 'TJRS' e 'tjrs' na mesma base, e o cálculo de prazo erraria por não achar o
-- feriado.
create table tribunais (
  -- A sigla é a chave natural e é estável: aparece no número CNJ, na API do
  -- CNJ e na portaria. Um uuid aqui só acrescentaria um join para chegar num
  -- dado que já é identificador em todo lugar.
  sigla text primary key check (sigla ~ '^[A-Z0-9]{2,12}$'),

  nome text not null,

  -- Segmento do Judiciário conforme o dígito J do número CNJ. Guardado porque
  -- a competência muda a regra de prazo (o processo do trabalho tem contagem
  -- própria), e porque o robô usa isso para escolher o endpoint do CNJ.
  segmento text not null check (segmento in (
    'estadual', 'federal', 'trabalho', 'eleitoral', 'militar', 'superior'
  )),

  -- NULL para tribunal de alcance nacional (STJ, STF, TST). Serve para
  -- resolver feriado estadual sem consultar o processo.
  uf uf,

  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

comment on table tribunais is
  'Catálogo global, sem escritorio_id: a sigla de um tribunal é a mesma para '
  'todos os escritórios. Escrita só por service_role.';

-- ----------------------------------------------------------------------------
-- clientes
-- ----------------------------------------------------------------------------

create table clientes (
  id uuid primary key default gen_random_uuid(),
  escritorio_id uuid not null references escritorios(id) on delete restrict,

  tipo_pessoa text not null check (tipo_pessoa in ('fisica', 'juridica')),

  -- Um campo para nome de pessoa física e razão social de pessoa jurídica.
  -- Duas colunas mutuamente exclusivas obrigariam todo SELECT, todo ORDER BY
  -- e toda busca a fazer COALESCE, e uma das duas estaria sempre nula — o que
  -- é a definição de coluna que não deveria existir.
  nome text not null check (length(trim(nome)) > 0),

  -- Nome de fantasia de PJ, ou como o cliente prefere ser chamado. Cortesia
  -- que muda a comunicação, não a identificação.
  nome_social text,

  documento documento_fiscal,

  email citext,
  telefone text,

  -- Endereço em colunas e não em jsonb: comarca e UF do cliente entram em
  -- decisão de competência e em conferência de dado do tribunal, então são
  -- consultados e filtrados. jsonb aqui trocaria constraint e índice por
  -- flexibilidade que ninguém pediu.
  cep text check (cep is null or cep ~ '^[0-9]{8}$'),
  logradouro text,
  numero text,
  complemento text,
  bairro text,
  municipio text,
  uf uf,

  observacoes text,

  criado_por uuid references usuarios(id),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  excluido_em timestamptz,
  excluido_por uuid references usuarios(id)
);

-- Único por escritório e não globalmente: a mesma pessoa pode ser cliente de
-- dois escritórios diferentes na nossa base, e não é da nossa conta cruzar
-- isso. Índice parcial porque documento é nullable (cliente estrangeiro,
-- espólio, cadastro iniciado antes de ter o documento em mão) e NULL não
-- colide em UNIQUE — mas dois cadastros do MESMO CPF no mesmo escritório é
-- erro de digitação que produz cliente duplicado e processo órfão.
create unique index clientes_documento_unico
  on clientes (escritorio_id, documento)
  where documento is not null and excluido_em is null;

create index clientes_escritorio_idx
  on clientes (escritorio_id) where excluido_em is null;

-- ----------------------------------------------------------------------------
-- processos
-- ----------------------------------------------------------------------------

create type situacao_processo as enum (
  'ativo',
  'suspenso',     -- art. 313 do CPC e afins; prazo não corre
  'arquivado',    -- arquivado provisoriamente, pode voltar
  'baixado',      -- baixa definitiva
  'encerrado'     -- trânsito em julgado, nada mais a fazer
);

create table processos (
  id uuid primary key default gen_random_uuid(),
  escritorio_id uuid not null references escritorios(id) on delete restrict,

  -- Vinte dígitos, sem máscara (Res. CNJ 65/2008). Guardar formatado
  -- obrigaria a normalizar antes de todo casamento com a API do CNJ, e a
  -- publicação chega com pontuação variável — o único jeito de casar sem
  -- falso negativo é os dois lados estarem normalizados. A máscara é
  -- apresentação.
  --
  -- Nullable porque existe procedimento administrativo e processo físico
  -- antigo sem número CNJ, e um NOT NULL aqui empurraria a secretaria a
  -- inventar número para conseguir cadastrar.
  numero_cnj text check (numero_cnj ~ '^[0-9]{20}$'),

  -- A pasta interna do escritório. É por ela que o advogado procura o caso no
  -- dia a dia, e ela não coincide com o número CNJ.
  numero_pasta text,

  tribunal text references tribunais(sigla) on delete restrict,
  orgao_julgador text,   -- a vara, câmara ou turma
  comarca text,
  uf uf,

  classe text,    -- classe processual da tabela unificada do CNJ
  assunto text,

  -- numeric e não float, como o briefing manda: float não representa 0,10
  -- exatamente, e valor de causa entra em cálculo de custas e de honorário de
  -- sucumbência. Escala 2 porque é dinheiro.
  valor_causa numeric(14,2) check (valor_causa is null or valor_causa >= 0),

  -- date e não timestamptz: distribuição é um dia, e não um instante. Guardar
  -- com fuso convidaria a um erro de um dia na virada, que em contagem de
  -- prazo é a diferença entre tempestivo e intempestivo.
  data_distribuicao date,

  situacao situacao_processo not null default 'ativo',

  -- O interruptor de sigilo. NOT NULL com default false porque a ausência de
  -- informação tem que significar "não sigiloso" de forma explícita — NULL
  -- aqui seria um terceiro estado que toda policy teria que tratar, e a
  -- primeira que esquecesse trataria como falso.
  --
  -- Enquanto isto é true, o processo NÃO é legível por SELECT direto: as
  -- policies abaixo o excluem, e a leitura passa pela RPC que registra o
  -- acesso (migration de auditoria). Postgres não tem trigger de SELECT, e
  -- essa é a única forma de o log ser garantia e não boa intenção.
  segredo_justica boolean not null default false,

  -- Quem responde pelo caso. Base de uma das alternativas da policy de
  -- visibilidade, e destinatário padrão da notificação de prazo novo.
  advogado_responsavel_id uuid references usuarios(id) on delete restrict,

  criado_por uuid references usuarios(id),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  excluido_em timestamptz,
  excluido_por uuid references usuarios(id)
);

-- Por escritório, não global. Dois escritórios clientes nossos podem estar em
-- lados opostos do mesmo processo, e um UNIQUE global impediria o segundo de
-- cadastrar o caso dele — além de ser, por si, um vazamento: a falha de
-- inserção informaria que outro escritório na base tem aquele processo.
create unique index processos_numero_cnj_unico
  on processos (escritorio_id, numero_cnj)
  where numero_cnj is not null and excluido_em is null;

create index processos_escritorio_idx
  on processos (escritorio_id) where excluido_em is null;
create index processos_responsavel_idx
  on processos (advogado_responsavel_id) where excluido_em is null;
-- O robô casa publicação com processo por este índice, e ele é o caminho
-- quente da rotina diária.
create index processos_numero_cnj_busca
  on processos (numero_cnj) where numero_cnj is not null;

-- ----------------------------------------------------------------------------
-- partes
-- ----------------------------------------------------------------------------

create type polo_processual as enum ('ativo', 'passivo', 'terceiro');

-- Guarda todas as partes do processo, inclusive as adversas. A parte que é
-- nosso cliente aponta para `clientes`; a adversa tem cliente_id nulo. É a
-- tabela de ligação entre processo e cliente, e o N:N é real: litisconsórcio
-- coloca dois clientes nossos no mesmo caso.
create table partes (
  id uuid primary key default gen_random_uuid(),
  escritorio_id uuid not null references escritorios(id) on delete restrict,
  processo_id uuid not null references processos(id) on delete restrict,

  polo polo_processual not null,

  -- Autor, réu, exequente, executado, terceiro interessado, assistente,
  -- litisdenunciado... É text e não enum porque a lista varia por tipo de
  -- procedimento e cresce; enum exigiria migration para acomodar um
  -- procedimento que a equipe não previu, e travar cadastro de processo por
  -- falta de um rótulo é pior que aceitar texto.
  qualificacao text not null,

  nome text not null check (length(trim(nome)) > 0),
  documento documento_fiscal,

  -- Preenchido quando esta parte é cliente do escritório; nulo na parte
  -- adversa. NÃO é o que autoriza o portal — a autorização é a concessão
  -- explícita em acessos_portal, na migration seguinte. Ver a justificativa
  -- lá: casar parte com login por documento transforma erro de digitação em
  -- vazamento.
  cliente_id uuid references clientes(id) on delete restrict,

  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  excluido_em timestamptz,
  excluido_por uuid references usuarios(id)
);

create index partes_processo_idx on partes (processo_id) where excluido_em is null;
create index partes_cliente_idx on partes (cliente_id) where cliente_id is not null;

-- ----------------------------------------------------------------------------
-- processos_equipe
-- ----------------------------------------------------------------------------

-- Materializa o "associado e estagiário veem só o que é deles" do briefing.
--
-- As alternativas descartadas: derivar de advogado_responsavel_id deixaria só
-- uma pessoa ver o caso, e caso trabalhado a quatro mãos obrigaria a trocar o
-- responsável de ida e volta. Derivar de "tem tarefa em aberto" faria o
-- acesso aparecer e desaparecer conforme as tarefas fecham — o estagiário
-- perderia o histórico do que ele mesmo fez ao concluir.
create table processos_equipe (
  id uuid primary key default gen_random_uuid(),
  escritorio_id uuid not null references escritorios(id) on delete restrict,
  processo_id uuid not null references processos(id) on delete restrict,
  usuario_id uuid not null references usuarios(id) on delete restrict,

  incluido_por uuid references usuarios(id),
  incluido_em timestamptz not null default now(),

  -- Saída registrada em vez de linha apagada: para saber depois quem tinha
  -- acesso ao processo na data em que algo aconteceu. Em processo sigiloso
  -- isso é parte da trilha de acesso.
  removido_por uuid references usuarios(id),
  removido_em timestamptz
);

create unique index processos_equipe_unico
  on processos_equipe (processo_id, usuario_id)
  where removido_em is null;

create index processos_equipe_usuario_idx
  on processos_equipe (usuario_id) where removido_em is null;

-- ----------------------------------------------------------------------------
-- Triggers
-- ----------------------------------------------------------------------------

create trigger clientes_atualizado_em before update on clientes
  for each row execute function app.tocar_atualizado_em();
create trigger processos_atualizado_em before update on processos
  for each row execute function app.tocar_atualizado_em();
create trigger partes_atualizado_em before update on partes
  for each row execute function app.tocar_atualizado_em();
create trigger tribunais_atualizado_em before update on tribunais
  for each row execute function app.tocar_atualizado_em();

create trigger clientes_escritorio_imutavel before update on clientes
  for each row execute function app.escritorio_id_imutavel();
create trigger processos_escritorio_imutavel before update on processos
  for each row execute function app.escritorio_id_imutavel();
create trigger partes_escritorio_imutavel before update on partes
  for each row execute function app.escritorio_id_imutavel();
create trigger processos_equipe_escritorio_imutavel before update on processos_equipe
  for each row execute function app.escritorio_id_imutavel();

-- Impede que uma linha filha aponte para pai de outro escritório. A FK
-- garante que o pai existe, não que ele seja do mesmo tenant — e uma parte
-- pendurada em processo de outro escritório é vazamento por composição: a
-- policy da filha autoriza pela própria coluna e entrega dado alheio.
create or replace function app.coerencia_tenant_filho()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  escritorio_pai uuid;
  coluna_pai text := tg_argv[0];
  tabela_pai text := tg_argv[1];
  id_pai uuid;
begin
  execute format('select ($1).%I', coluna_pai) into id_pai using new;
  if id_pai is null then
    return new;
  end if;

  execute format(
    'select escritorio_id from public.%I where id = $1', tabela_pai
  ) into escritorio_pai using id_pai;

  if escritorio_pai is distinct from new.escritorio_id then
    raise exception
      '%.% aponta para %(%) do escritório %, mas a linha é do escritório %',
      tg_table_name, coluna_pai, tabela_pai, id_pai,
      escritorio_pai, new.escritorio_id
      using errcode = 'foreign_key_violation';
  end if;
  return new;
end;
$$;

create trigger partes_tenant_processo
  before insert or update on partes
  for each row execute function app.coerencia_tenant_filho('processo_id', 'processos');
create trigger partes_tenant_cliente
  before insert or update on partes
  for each row execute function app.coerencia_tenant_filho('cliente_id', 'clientes');
create trigger processos_equipe_tenant_processo
  before insert or update on processos_equipe
  for each row execute function app.coerencia_tenant_filho('processo_id', 'processos');
create trigger processos_equipe_tenant_usuario
  before insert or update on processos_equipe
  for each row execute function app.coerencia_tenant_filho('usuario_id', 'usuarios');

-- ----------------------------------------------------------------------------
-- Visibilidade de processo — escrita uma vez, aqui
-- ----------------------------------------------------------------------------

-- Devolve os processos em que o usuário logado foi incluído na equipe.
--
-- É função retornando conjunto, e não um predicado por linha, porque a policy
-- a usa como `id in (select ...)`: sem correlação com a linha, o planejador
-- avalia uma vez por statement e resolve por semi-join. Um predicado
-- `app.posso_ver(id)` seria chamado uma vez por linha, e listar quinhentos
-- processos custaria quinhentas consultas.
--
-- SECURITY DEFINER para não passar pela RLS de processos_equipe e criar ciclo:
-- a policy de processos consultaria processos_equipe, cuja policy consultaria
-- processos.
create or replace function app.processos_atribuidos()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select pe.processo_id
    from public.processos_equipe pe
    join public.usuarios u on u.id = pe.usuario_id
   where pe.usuario_id = auth.uid()
     and pe.removido_em is null
     and u.ativo
     and u.excluido_em is null
$$;

-- ----------------------------------------------------------------------------
-- Grants
-- ----------------------------------------------------------------------------

grant select on tribunais to authenticated;
-- Sem INSERT/UPDATE em tribunais para authenticated: catálogo global é
-- mantido pela Flypi via service_role. Um escritório renomeando TJRS mudaria
-- o cálculo de feriado de todos os outros.

grant select, insert, update on clientes, processos, partes, processos_equipe
  to authenticated;

-- ----------------------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------------------

alter table tribunais enable row level security;
alter table clientes enable row level security;
alter table processos enable row level security;
alter table partes enable row level security;
alter table processos_equipe enable row level security;

alter table tribunais force row level security;
alter table clientes force row level security;
alter table processos force row level security;
alter table partes force row level security;
alter table processos_equipe force row level security;

-- --- tribunais: leitura para qualquer autenticado ---

-- Não há segredo em "TJRS é o Tribunal de Justiça do RS", e o cliente do
-- portal também precisa ler para ver onde tramita o caso dele.
create policy tribunais_leitura on tribunais
  for select to authenticated
  using (ativo);

-- --- clientes ---

-- Só equipe interna, e só quem enxerga o escritório todo. Associado e
-- estagiário chegam ao cliente pelo processo em que trabalham, via `partes`;
-- a lista completa da carteira de clientes do escritório não é dado de quem
-- cumpre tarefa.
create policy clientes_leitura_interna on clientes
  for select to authenticated
  using (
    escritorio_id = app.escritorio_atual()
    and excluido_em is null
    and app.enxerga_escritorio_todo()
  );

create policy clientes_escrita_interna on clientes
  for insert to authenticated
  with check (
    escritorio_id = app.escritorio_atual()
    and app.enxerga_escritorio_todo()
  );

create policy clientes_atualizacao_interna on clientes
  for update to authenticated
  using (
    escritorio_id = app.escritorio_atual()
    and excluido_em is null
    and app.enxerga_escritorio_todo()
  )
  with check (escritorio_id = app.escritorio_atual());

-- --- processos: a policy que todas as filhas herdam ---

-- Três caminhos para ver um processo, e nenhum deles atravessa escritório:
--   1. enxerga o escritório todo (responsável, secretaria, admin)
--   2. é o advogado responsável pelo caso
--   3. foi incluído na equipe do caso
--
-- Processo em segredo de justiça está fora de todos: `not segredo_justica`.
-- A leitura dele passa pela RPC auditada da migration de auditoria, e até
-- aquela migration existir o sigiloso simplesmente não é legível pela
-- aplicação. É o lado certo para errar — indisponível é problema visível,
-- lido sem rastro não é.
create policy processos_leitura_interna on processos
  for select to authenticated
  using (
    escritorio_id = app.escritorio_atual()
    and excluido_em is null
    and not segredo_justica
    and (
      app.enxerga_escritorio_todo()
      or advogado_responsavel_id = auth.uid()
      or id in (select app.processos_atribuidos())
    )
  );

create policy processos_escrita_interna on processos
  for insert to authenticated
  with check (
    escritorio_id = app.escritorio_atual()
    and app.enxerga_escritorio_todo()
  );

-- Quem trabalha no caso atualiza o caso; quem não vê, não atualiza. O USING
-- repete o recorte da leitura de propósito: sem ele, um UPDATE conseguiria
-- alterar linha que o mesmo usuário não pode ler.
create policy processos_atualizacao_interna on processos
  for update to authenticated
  using (
    escritorio_id = app.escritorio_atual()
    and excluido_em is null
    and not segredo_justica
    and (
      app.enxerga_escritorio_todo()
      or advogado_responsavel_id = auth.uid()
      or id in (select app.processos_atribuidos())
    )
  )
  with check (escritorio_id = app.escritorio_atual());

-- --- partes: visível porque o processo é visível ---

-- O EXISTS abaixo consulta `processos`, e essa consulta passa pela RLS de
-- `processos`. É composição deliberada: a regra de visibilidade está escrita
-- num lugar só, e mudá-la lá vale aqui automaticamente.
--
-- O filtro de escritorio_id é redundante com isso — o processo visível já é
-- do escritório certo. Fica porque é barato, porque a suíte exige a coluna em
-- toda tabela de domínio, e porque um erro futuro na policy de processos
-- encontra aqui uma segunda trava em vez de passagem livre.
create policy partes_leitura on partes
  for select to authenticated
  using (
    escritorio_id = app.escritorio_atual()
    and excluido_em is null
    and exists (select 1 from processos p where p.id = partes.processo_id)
  );

create policy partes_escrita on partes
  for insert to authenticated
  with check (
    escritorio_id = app.escritorio_atual()
    and exists (select 1 from processos p where p.id = partes.processo_id)
  );

create policy partes_atualizacao on partes
  for update to authenticated
  using (
    escritorio_id = app.escritorio_atual()
    and excluido_em is null
    and exists (select 1 from processos p where p.id = partes.processo_id)
  )
  with check (escritorio_id = app.escritorio_atual());

-- --- processos_equipe ---

-- Leitura: quem vê o processo vê quem trabalha nele. Ninguém delega sem saber
-- quem já está no caso.
create policy processos_equipe_leitura on processos_equipe
  for select to authenticated
  using (
    escritorio_id = app.escritorio_atual()
    and exists (select 1 from processos p where p.id = processos_equipe.processo_id)
  );

-- Escrita: só quem enxerga o escritório todo. Se o próprio associado pudesse
-- se incluir na equipe de um caso, a tabela deixaria de ser controle de
-- acesso e passaria a ser autoatendimento — qualquer estagiário alcançaria
-- qualquer processo do escritório.
create policy processos_equipe_escrita on processos_equipe
  for insert to authenticated
  with check (
    escritorio_id = app.escritorio_atual()
    and app.enxerga_escritorio_todo()
  );

create policy processos_equipe_atualizacao on processos_equipe
  for update to authenticated
  using (
    escritorio_id = app.escritorio_atual()
    and app.enxerga_escritorio_todo()
  )
  with check (escritorio_id = app.escritorio_atual());
