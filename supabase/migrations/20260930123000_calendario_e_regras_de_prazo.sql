-- ============================================================================
-- Calendário forense e catálogo de regras de prazo
-- ============================================================================
--
-- O briefing manda os feriados para o banco, e a razão está escrita nele:
-- portaria de tribunal sai no meio do ano, e se o cadastro depender de deploy
-- um esquecimento vira prazo perdido. Esta migration estende a mesma lógica
-- às REGRAS de prazo, e por um motivo que o briefing também registra: ninguém
-- da equipe é advogado.
--
-- Regra de prazo em código é regra que três programadores inseriram por
-- leitura própria de artigo de lei. Regra em tabela, com fundamento legal
-- escrito e o nome de quem ratificou, é regra que um advogado assinou — e que
-- pode ser corrigida sem release quando ele apontar o erro. O risco maior
-- deste projeto é processual, não técnico, e isto é o que o schema pode fazer
-- a respeito.
--
-- CONSEQUÊNCIA DELIBERADA: a tabela regras_prazo nasce VAZIA. Sem regra
-- ratificada, o sistema não sugere prazo — devolve "ato não catalogado, prazo
-- a definir manualmente". Preferimos não sugerir a sugerir errado: o silêncio
-- é visível para o advogado, o número errado não é.
--
-- O QUE NÃO ESTÁ DECIDIDO, e por isso não está implementado: o termo inicial
-- da contagem. Envolve a distinção entre divulgação e publicação no DJEN e os
-- parágrafos do art. 224 do CPC, mais o art. 231 para as outras formas de
-- intimação. O schema acomoda as alternativas numa coluna; qual delas vale
-- para cada ato é resposta de advogado, e a função de cálculo não será escrita
-- antes dessa revisão.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- feriados — catálogo global
-- ----------------------------------------------------------------------------

create type abrangencia_feriado as enum (
  'nacional',
  'estadual',
  'municipal',
  'tribunal'    -- portaria de tribunal específico
);

-- A distinção entre os dois primeiros valores é a que muda a conta, e ela
-- precisa de ratificação jurídica antes de a função de cálculo existir:
--   dia_nao_util     — o dia não conta na contagem em dias úteis, mas a
--                      contagem em dias corridos segue (art. 219 do CPC
--                      manda contar prazo processual só em dia útil)
--   suspende_prazo   — o curso do prazo para, e volta a correr depois. É o
--                      caso do recesso de 20/12 a 20/01 (art. 220 do CPC),
--                      que suspende e não apenas deixa de contar
create type efeito_feriado as enum ('dia_nao_util', 'suspende_prazo');

-- Sem escritorio_id: é catálogo global, curado pela Flypi. Portaria do TJRS
-- vale para todo escritório que atua no TJRS, e deixar cada um cadastrar a
-- sua produziria dois escritórios calculando datas diferentes para o mesmo
-- prazo — com o nosso nome nas duas contas.
create table feriados (
  id uuid primary key default gen_random_uuid(),

  abrangencia abrangencia_feriado not null,

  -- Preenchidos conforme a abrangência; o check abaixo garante a combinação.
  uf uf,
  municipio text,
  tribunal text references tribunais(sigla) on delete restrict,

  -- Intervalo, e não uma linha por dia. O recesso forense é um período
  -- contínuo de trinta e dois dias; uma linha por dia significaria trinta e
  -- duas chances de errar o cadastro e nenhuma forma de conferir se o período
  -- está completo. Feriado de um dia tem inicio = fim.
  data_inicio date not null,
  data_fim date not null,
  check (data_fim >= data_inicio),

  efeito efeito_feriado not null,

  descricao text not null check (length(trim(descricao)) > 0),

  -- O ato que sustenta o lançamento: "Portaria 123/2026 do TJRS", "Lei
  -- 10.607/2002". Não é enfeite — é o que permite conferir um cadastro
  -- suspeito antes de um prazo ser perdido por causa dele, e o que dá para
  -- mostrar ao advogado que perguntar de onde veio a data.
  fundamento text not null check (length(trim(fundamento)) > 0),
  fonte_url text,

  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),

  -- A combinação precisa fechar com a abrangência, senão um feriado municipal
  -- sem município se aplicaria a todo mundo — erro que só aparece como prazo
  -- errado semanas depois.
  constraint feriado_escopo_coerente check (
    case abrangencia
      when 'nacional' then uf is null and municipio is null and tribunal is null
      when 'estadual' then uf is not null and municipio is null and tribunal is null
      when 'municipal' then uf is not null and municipio is not null and tribunal is null
      when 'tribunal' then tribunal is not null and municipio is null
    end
  )
);

comment on table feriados is
  'Catálogo global de feriados e suspensões, curado pela Flypi. Escrita por '
  'service_role. Exceções locais do escritório ficam em feriados_escritorio.';

-- A consulta do cálculo é sempre "que feriados incidem neste intervalo, para
-- este tribunal/UF" — um range scan por data.
create index feriados_periodo_idx on feriados (data_inicio, data_fim);
create index feriados_tribunal_idx on feriados (tribunal) where tribunal is not null;

-- ----------------------------------------------------------------------------
-- feriados_escritorio — exceções locais
-- ----------------------------------------------------------------------------

-- Preserva o critério de aceite "feriado novo é cadastrado pela interface, sem
-- deploy" sem abrir mão do catálogo comum. O feriado municipal da comarca onde
-- o escritório atua, ou a portaria que a Flypi ainda não lançou, entram aqui
-- na hora, pelo próprio escritório.
--
-- Tabela separada em vez de escritorio_id nullable na tabela de cima: com
-- coluna nullable, TODA policy e TODA consulta do cálculo teria que lembrar de
-- tratar o NULL como "vale para todos", e a primeira que esquecesse ou
-- vazaria o feriado de um escritório para outro, ou perderia o catálogo
-- global. Duas tabelas com regras claras valem mais que uma com um NULL
-- semanticamente carregado.
create table feriados_escritorio (
  id uuid primary key default gen_random_uuid(),
  escritorio_id uuid not null references escritorios(id) on delete restrict,

  abrangencia abrangencia_feriado not null,
  uf uf,
  municipio text,
  tribunal text references tribunais(sigla) on delete restrict,

  data_inicio date not null,
  data_fim date not null,
  check (data_fim >= data_inicio),

  efeito efeito_feriado not null,
  descricao text not null check (length(trim(descricao)) > 0),
  fundamento text not null check (length(trim(fundamento)) > 0),
  fonte_url text,

  criado_por uuid references usuarios(id),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  excluido_em timestamptz,
  excluido_por uuid references usuarios(id),

  constraint feriado_escritorio_escopo_coerente check (
    case abrangencia
      when 'nacional' then uf is null and municipio is null and tribunal is null
      when 'estadual' then uf is not null and municipio is null and tribunal is null
      when 'municipal' then uf is not null and municipio is not null and tribunal is null
      when 'tribunal' then tribunal is not null and municipio is null
    end
  )
);

create index feriados_escritorio_periodo_idx
  on feriados_escritorio (escritorio_id, data_inicio, data_fim)
  where excluido_em is null;

-- ----------------------------------------------------------------------------
-- tipos_ato — o que foi publicado
-- ----------------------------------------------------------------------------

-- Tabela e não enum, pela mesma razão dos feriados: a lista cresce conforme a
-- prática, e um ato novo não pode depender de release para ser catalogado.
-- Enquanto o tipo não existe aqui, a publicação fica pendente de triagem
-- humana, o que é o comportamento certo.
create table tipos_ato (
  codigo text primary key check (codigo ~ '^[a-z0-9_]{3,60}$'),
  nome text not null,
  descricao text,

  -- Se um ato deste tipo normalmente abre prazo. Falso para ato de mero
  -- expediente (juntada, vista, mero despacho de andamento), que representa a
  -- maior parte do volume de publicação e não deve gerar nada a confirmar —
  -- avalanche de sugestão vazia treina o advogado a ignorar as sugestões, e aí
  -- ele ignora a que importava.
  gera_prazo boolean not null default true,

  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- regras_prazo — nasce vazia, por decisão
-- ----------------------------------------------------------------------------

create type tipo_contagem as enum (
  'dias_uteis',     -- prazo processual: art. 219 do CPC
  'dias_corridos'   -- prazo material, e os casos em que a lei dispõe diferente
);

-- As alternativas de termo inicial que o sistema precisa saber distinguir.
-- Qual delas se aplica a cada ato é a pendência jurídica registrada no topo
-- desta migration: o enum existe para que a resposta caiba no dado quando ela
-- vier, não para que alguém a escolha por dedução agora.
create type termo_inicial as enum (
  'publicacao',
  'divulgacao',
  'intimacao_pessoal',
  'juntada_aos_autos',
  'ciencia_inequivoca'
);

create table regras_prazo (
  id uuid primary key default gen_random_uuid(),

  tipo_ato text not null references tipos_ato(codigo) on delete restrict,

  -- Recorte opcional: a mesma espécie de ato pode ter prazo diferente por
  -- segmento (o processo do trabalho tem contagem própria) ou por tribunal.
  -- NULL significa "vale onde não houver regra mais específica", e a resolução
  -- do mais específico é da função de cálculo — que ainda não existe, e não vai
  -- existir antes da revisão jurídica.
  segmento text check (segmento is null or segmento in (
    'estadual', 'federal', 'trabalho', 'eleitoral', 'militar', 'superior'
  )),
  tribunal text references tribunais(sigla) on delete restrict,

  dias integer not null check (dias > 0),
  contagem tipo_contagem not null,
  termo_inicial termo_inicial not null,

  -- Obrigatório, e é o coração desta tabela. O briefing manda escrever o
  -- artigo de lei que sustenta cada regra; aqui isso é constraint e não
  -- convenção. Regra sem fundamento não entra.
  fundamento_legal text not null check (length(trim(fundamento_legal)) > 0),

  -- Vigência, porque a lei muda e o prazo de um ato de 2024 tem que continuar
  -- sendo recalculável pela regra de 2024. Sem isto, uma correção de regra
  -- reescreveria retroativamente a contagem de processos já em curso.
  vigencia_inicio date not null,
  vigencia_fim date,
  check (vigencia_fim is null or vigencia_fim >= vigencia_inicio),

  -- A ratificação. Texto e não FK para usuarios: quem assina é um advogado com
  -- inscrição na OAB, e ele não é — nem precisa ser — usuário do sistema. O
  -- que importa registrar é o nome e a inscrição de quem assumiu a
  -- responsabilidade profissional pela regra.
  ratificado_por text,
  ratificado_oab text,
  ratificado_em timestamptz,

  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),

  -- Ratificação é tudo-ou-nada: meia ratificação (nome sem data, data sem
  -- nome) produziria uma regra que parece revisada e não foi.
  constraint ratificacao_completa check (
    (ratificado_por is null and ratificado_oab is null and ratificado_em is null)
    or (ratificado_por is not null and ratificado_oab is not null
        and ratificado_em is not null)
  )
);

-- Coluna gerada, e não um filtro que cada consulta precisa lembrar de aplicar.
-- É por ela que a função de cálculo vai selecionar regra: o que não está
-- ratificado não sugere prazo, e a condição fica no schema em vez de espalhada
-- pelo código.
alter table regras_prazo
  add column aplicavel boolean
  generated always as (ratificado_em is not null) stored;

comment on column regras_prazo.aplicavel is
  'Regra sem ratificação de advogado não sugere prazo. O sistema devolve '
  '"ato não catalogado" — o silêncio é visível para o advogado, o número '
  'errado não é.';

create unique index regras_prazo_vigente_unica
  on regras_prazo (tipo_ato, coalesce(segmento, ''), coalesce(tribunal, ''),
                   vigencia_inicio);

-- ----------------------------------------------------------------------------
-- Triggers
-- ----------------------------------------------------------------------------

create trigger feriados_atualizado_em before update on feriados
  for each row execute function app.tocar_atualizado_em();
create trigger feriados_escritorio_atualizado_em before update on feriados_escritorio
  for each row execute function app.tocar_atualizado_em();
create trigger tipos_ato_atualizado_em before update on tipos_ato
  for each row execute function app.tocar_atualizado_em();
create trigger regras_prazo_atualizado_em before update on regras_prazo
  for each row execute function app.tocar_atualizado_em();
create trigger feriados_escritorio_escritorio_imutavel before update on feriados_escritorio
  for each row execute function app.escritorio_id_imutavel();

-- ----------------------------------------------------------------------------
-- Grants e RLS
-- ----------------------------------------------------------------------------

-- Catálogos globais: leitura para qualquer autenticado, escrita por
-- service_role. O cliente do portal também lê, porque a data de vencimento que
-- ele vê no portal precisa ser explicável pelo mesmo calendário.
grant select on feriados, tipos_ato, regras_prazo to authenticated;
grant select, insert, update on feriados_escritorio to authenticated;

alter table feriados enable row level security;
alter table feriados_escritorio enable row level security;
alter table tipos_ato enable row level security;
alter table regras_prazo enable row level security;

alter table feriados force row level security;
alter table feriados_escritorio force row level security;
alter table tipos_ato force row level security;
alter table regras_prazo force row level security;

create policy feriados_leitura on feriados
  for select to authenticated using (true);

create policy tipos_ato_leitura on tipos_ato
  for select to authenticated using (ativo);

-- Inclusive as não ratificadas: quem confere o cálculo precisa poder ver que
-- existe uma regra proposta e que ela ainda não valeu. Esconder produziria a
-- pergunta "por que este ato não sugeriu prazo?" sem resposta na tela.
create policy regras_prazo_leitura on regras_prazo
  for select to authenticated using (true);

-- --- feriados_escritorio ---

create policy feriados_escritorio_leitura on feriados_escritorio
  for select to authenticated
  using (escritorio_id = app.escritorio_atual() and excluido_em is null);

-- Cadastrar feriado muda a data de vencimento de todos os prazos do
-- escritório. É poder de administração, não de cadastro corriqueiro — e o
-- critério de aceite pede que seja possível pela interface, não que seja
-- possível para qualquer um.
create policy feriados_escritorio_escrita on feriados_escritorio
  for insert to authenticated
  with check (
    escritorio_id = app.escritorio_atual()
    and (app.eh_admin() or app.papel_atual() = 'advogado_responsavel')
  );

create policy feriados_escritorio_atualizacao on feriados_escritorio
  for update to authenticated
  using (
    escritorio_id = app.escritorio_atual()
    and excluido_em is null
    and (app.eh_admin() or app.papel_atual() = 'advogado_responsavel')
  )
  with check (escritorio_id = app.escritorio_atual());
