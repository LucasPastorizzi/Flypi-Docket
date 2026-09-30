-- ============================================================================
-- Publicações cruas, prazos sugeridos e tarefas
-- ============================================================================
--
-- Dois critérios de aceite do briefing moram nesta migration, e os dois são
-- garantidos por constraint e não por código de aplicação:
--
--   "a mesma publicação processada duas vezes não duplica prazo"
--   "prazo só vira compromisso depois de confirmação humana"
--
-- A escolha de onde garantir importa. Idempotência checada na Edge Function
-- funciona até duas invocações da rotina rodarem concorrentes — o que
-- acontece quando a anterior demora e a próxima entra no horário —, e aí as
-- duas consultam, as duas não encontram nada, e as duas inserem. Índice único
-- não tem essa janela. O mesmo vale para a confirmação humana: se a regra
-- estiver só no front, o primeiro script de importação a rodar por fora cria
-- compromisso que ninguém confirmou.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- publicacoes — gravadas cruas
-- ----------------------------------------------------------------------------

create type fonte_publicacao as enum (
  'djen',      -- Comunicações do DJEN (CNJ)
  'datajud',   -- DataJud (CNJ)
  'manual'     -- lançada à mão pelo escritório
);

create type status_publicacao as enum (
  'pendente',      -- gravada, à espera de interpretação
  'processada',    -- interpretada, com ou sem prazo gerado
  'sem_processo',  -- não casou com processo cadastrado; espera triagem humana
  'ignorada',      -- triada como irrelevante (mero expediente)
  'erro'           -- falhou na interpretação; ver erro_ultimo
);

create table publicacoes (
  id uuid primary key default gen_random_uuid(),

  -- Uma cópia por escritório, e não uma linha global com tabela de ligação.
  -- Dois escritórios nossos podem atuar em lados opostos do mesmo processo, e
  -- a linha global seria uma tabela de domínio sem escritorio_id — exceção
  -- justamente na camada que precisa ser uniforme. O custo é jsonb repetido,
  -- que é barato; o benefício é que o isolamento aqui é o mesmo de todas as
  -- outras tabelas, sem caso especial para alguém esquecer.
  escritorio_id uuid not null references escritorios(id) on delete restrict,

  fonte fonte_publicacao not null,

  -- A resposta da API como ela veio, sem interpretação. É o que permite
  -- reprocessar quando uma regra de prazo for corrigida — e ela vai ser, é
  -- para isso que regras_prazo tem vigência. Se guardássemos só o resultado
  -- interpretado, corrigir a regra exigiria buscar de novo na API, que tem
  -- limite de consulta e janela de retenção.
  --
  -- jsonb e não json: precisamos indexar e consultar dentro do payload durante
  -- a triagem, e jsonb é o que suporta isso. O custo é não preservar a ordem
  -- das chaves nem espaço em branco, o que não tem valor aqui.
  payload jsonb not null,

  -- O identificador da publicação na origem. É a primeira trava de
  -- idempotência. Nullable porque não está verificado que o DJEN forneça um
  -- id estável em toda resposta — a documentação do CNJ precisa ser conferida
  -- antes de o robô ser escrito, e o schema não deve depender de uma suposição
  -- sobre API de terceiro.
  id_externo text,

  -- A segunda trava, que funciona mesmo sem id na origem: hash do conteúdo que
  -- identifica a publicação. Calculado pela Edge Function sobre os campos
  -- relevantes do payload, nunca sobre o payload inteiro — metadado de
  -- requisição (timestamp da consulta, número de página) mudaria o hash e a
  -- mesma publicação entraria de novo.
  hash_conteudo text not null,

  -- Como o número veio, e como ficou depois de normalizado. Os dois, porque
  -- o casamento com `processos` usa o normalizado e a conferência humana de
  -- um caso que não casou precisa ver o original.
  numero_processo_bruto text,
  numero_cnj text check (numero_cnj is null or numero_cnj ~ '^[0-9]{20}$'),

  -- Qual inscrição capturou esta publicação. É o que explica por que ela
  -- chegou, e o que permite desligar uma seccional sem perder o histórico do
  -- que ela trouxe.
  oab_id uuid references oabs_usuario(id) on delete restrict,

  -- Preenchido na interpretação. Nulo enquanto não casou com processo
  -- cadastrado, e é esse nulo que alimenta a fila de triagem.
  processo_id uuid references processos(id) on delete restrict,
  tipo_ato text references tipos_ato(codigo) on delete restrict,

  -- date e não timestamptz: publicação e divulgação são dias, e é sobre eles
  -- que a contagem de prazo incide. Guardar com fuso arriscaria um erro de um
  -- dia na virada, que em prazo é a diferença entre tempestivo e
  -- intempestivo.
  --
  -- As duas datas existem separadas porque a distinção entre divulgar e
  -- publicar é exatamente a pendência jurídica do termo inicial. Colapsá-las
  -- numa coluna seria decidir a questão por omissão de schema.
  data_divulgacao date,
  data_publicacao date,

  status status_publicacao not null default 'pendente',

  -- Controle da fila. A rotina processa em lotes com FOR UPDATE SKIP LOCKED
  -- sobre estas colunas: processar tudo numa invocação estoura o tempo limite
  -- da Edge Function, como o briefing observa.
  tentativas integer not null default 0 check (tentativas >= 0),
  erro_ultimo text,

  recebida_em timestamptz not null default now(),
  processada_em timestamptz,

  -- Sem exclusão lógica: publicação é o registro bruto do que o tribunal
  -- comunicou, e apagar — mesmo logicamente — é perder a única prova de que a
  -- comunicação chegou e quando. O que se descarta é a interpretação
  -- (status = 'ignorada'), nunca o fato.

  check (
    (status = 'erro') = (erro_ultimo is not null)
  )
);

-- PRIMEIRA TRAVA de idempotência. Por escritório, porque cada um tem a sua
-- cópia da mesma publicação quando os dois atuam no processo.
create unique index publicacoes_id_externo_unico
  on publicacoes (escritorio_id, fonte, id_externo)
  where id_externo is not null;

-- SEGUNDA TRAVA, que é a que segura o caso de a origem não fornecer id. As
-- duas juntas cobrem os dois modos de a mesma publicação voltar: reconsulta da
-- mesma janela de datas, e reenvio pela origem.
create unique index publicacoes_hash_unico
  on publicacoes (escritorio_id, hash_conteudo);

-- A fila. Índice parcial porque só o que está pendente ou em erro interessa
-- para a rotina, e essa fatia é minúscula perto do histórico acumulado.
create index publicacoes_fila_idx
  on publicacoes (escritorio_id, recebida_em)
  where status in ('pendente', 'erro');

create index publicacoes_processo_idx
  on publicacoes (processo_id) where processo_id is not null;

-- ----------------------------------------------------------------------------
-- prazos
-- ----------------------------------------------------------------------------

create type origem_prazo as enum ('publicacao', 'manual');

create type status_prazo as enum (
  'sugerido',    -- o sistema propôs; NÃO é compromisso
  'confirmado',  -- humano conferiu e aceitou a data sugerida
  'ajustado',    -- humano conferiu e corrigiu a data
  'cumprido',
  'perdido',     -- venceu sem cumprimento; registrado, não escondido
  'cancelado'    -- a sugestão não procedia, ou foi substituída em reprocessamento
);

create table prazos (
  id uuid primary key default gen_random_uuid(),
  escritorio_id uuid not null references escritorios(id) on delete restrict,
  processo_id uuid not null references processos(id) on delete restrict,

  origem origem_prazo not null,

  -- De qual publicação este prazo saiu. É a chave da idempotência do
  -- reprocessamento, no índice mais abaixo.
  publicacao_id uuid references publicacoes(id) on delete restrict,

  tipo_ato text references tipos_ato(codigo) on delete restrict,

  -- Qual versão da regra produziu esta sugestão. Sem isto, uma correção de
  -- regra deixaria de ser auditável: não haveria como saber se um prazo antigo
  -- foi calculado pela regra certa ou pela que estava errada.
  regra_prazo_id uuid references regras_prazo(id) on delete restrict,

  contagem tipo_contagem,
  dias integer check (dias is null or dias > 0),

  -- Prazo em dobro para litisconsortes com procuradores distintos, Defensoria
  -- e Fazenda Pública, como o briefing lista. O fundamento é obrigatório
  -- quando a dobra é aplicada: dobrar prazo sem dizer por quê é a mudança de
  -- data mais difícil de conferir depois.
  em_dobro boolean not null default false,
  fundamento_dobro text,
  check (not em_dobro or fundamento_dobro is not null),

  -- O dia do ato que dispara a contagem, e o dia em que a contagem começa a
  -- correr. São diferentes — o art. 224 do CPC exclui o dia do começo — e o
  -- briefing é explícito sobre a distinção. Guardar os dois deixa a conta
  -- conferível linha a linha em vez de exigir que alguém a refaça de cabeça.
  data_termo_inicial date,
  data_inicio_contagem date,

  -- As duas datas que não se misturam, e a razão de ser desta tabela.
  --
  -- A sugerida NUNCA é sobrescrita. Quando o advogado corrige a data, a
  -- correção vai na confirmada e a sugestão fica onde está — e a divergência
  -- entre as duas passa a ser o sinal mais valioso que vamos ter de que uma
  -- regra de prazo está errada. Sobrescrever apagaria exatamente a informação
  -- que permite descobrir o erro antes que ele custe um prazo.
  data_vencimento_sugerida date,
  data_vencimento_confirmada date,

  status status_prazo not null default 'sugerido',

  confirmado_por uuid references usuarios(id),
  confirmado_em timestamptz,

  responsavel_id uuid references usuarios(id) on delete restrict,

  -- O rastro da conta: os feriados aplicados, os dias contados, a regra usada.
  -- É o que se mostra ao advogado que pergunta "por que esta data?" — e sem
  -- isso a resposta seria reexecutar o cálculo e esperar que nada tenha
  -- mudado no meio, o que é justamente o que não se pode supor num sistema em
  -- que as regras e os feriados são dados editáveis.
  memoria_calculo jsonb,

  fundamento_legal text,
  observacao text,

  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  excluido_em timestamptz,
  excluido_por uuid references usuarios(id),

  -- "PRAZO SÓ VIRA COMPROMISSO DEPOIS DE CONFIRMAÇÃO HUMANA", no schema.
  --
  -- Sair de 'sugerido' exige as três coisas juntas: quem confirmou, quando, e
  -- a data que vale. Não há caminho — nem pela aplicação, nem por script, nem
  -- pela Edge Function com service_role — que produza compromisso sem um
  -- humano identificado atrás dele.
  constraint confirmacao_humana_obrigatoria check (
    status = 'sugerido'
    or status = 'cancelado'
    or (confirmado_por is not null
        and confirmado_em is not null
        and data_vencimento_confirmada is not null)
  ),

  -- Sugestão do sistema não pode nascer já confirmada por construção: a origem
  -- automática entra como 'sugerido' e ponto. O caso 'manual' é o advogado
  -- lançando um prazo que ele mesmo apurou, e aí a confirmação é dele desde o
  -- início.
  constraint sugestao_automatica_nasce_sugerida check (
    origem <> 'publicacao' or status <> 'confirmado'
    or confirmado_por is not null
  )
);

-- Coluna gerada em vez de um filtro que cada consulta lembra de aplicar. A
-- agenda do escritório mostra compromisso; sugestão pendente é outra lista, e
-- confundir as duas é mostrar como compromisso o que ninguém conferiu.
alter table prazos
  add column eh_compromisso boolean
  generated always as (status in ('confirmado', 'ajustado', 'cumprido', 'perdido'))
  stored;

-- "A MESMA PUBLICAÇÃO PROCESSADA DUAS VEZES NÃO DUPLICA PRAZO", no schema.
--
-- A chave inclui o tipo de ato porque uma publicação pode legitimamente
-- comunicar dois atos com prazos distintos. O coalesce trata o ato ainda não
-- catalogado: sem ele, NULL não colide com NULL e o reprocessamento criaria
-- uma sugestão nova a cada rodada, justamente no caso em que o sistema menos
-- entende o que está lendo.
--
-- 'cancelado' fica fora para que o reprocessamento depois de uma correção de
-- regra possa cancelar a sugestão antiga e emitir a nova — que é o fluxo para
-- o qual as publicações são gravadas cruas.
create unique index prazos_idempotencia_publicacao
  on prazos (publicacao_id, coalesce(tipo_ato, ''))
  where publicacao_id is not null and status <> 'cancelado';

create index prazos_agenda_idx
  on prazos (escritorio_id, data_vencimento_confirmada)
  where eh_compromisso and excluido_em is null;

-- A fila de confirmação: o que o advogado precisa olhar hoje.
create index prazos_pendentes_idx
  on prazos (escritorio_id, criado_em)
  where status = 'sugerido' and excluido_em is null;

create index prazos_responsavel_idx
  on prazos (responsavel_id) where excluido_em is null;
create index prazos_processo_idx
  on prazos (processo_id) where excluido_em is null;

-- ----------------------------------------------------------------------------
-- tarefas
-- ----------------------------------------------------------------------------

create type status_tarefa as enum (
  'aberta', 'em_andamento', 'concluida', 'cancelada'
);

-- Tabela distinta de `prazos`, e não uma coluna de tipo na mesma tabela. Um
-- prazo gera várias tarefas (pedir documento ao cliente, minutar, protocolar),
-- e existe tarefa sem prazo nenhum (ligar para o cliente, agendar reunião).
-- Unificar as duas obrigaria metade das colunas a ficar nula em metade das
-- linhas, e faria a constraint de confirmação humana — que é sobre prazo — ter
-- que conviver com linhas a que ela não se aplica.
create table tarefas (
  id uuid primary key default gen_random_uuid(),
  escritorio_id uuid not null references escritorios(id) on delete restrict,

  -- Nullable: tarefa administrativa do escritório não tem processo.
  processo_id uuid references processos(id) on delete restrict,
  prazo_id uuid references prazos(id) on delete restrict,

  titulo text not null check (length(trim(titulo)) > 0),
  descricao text,

  responsavel_id uuid references usuarios(id) on delete restrict,
  atribuido_por uuid references usuarios(id),

  status status_tarefa not null default 'aberta',

  -- date: tarefa vence num dia. Distinta do vencimento do prazo de propósito —
  -- a minuta fica pronta antes do dia do protocolo, e é essa antecedência que
  -- faz a tarefa servir para algo.
  data_limite date,

  concluida_em timestamptz,
  concluida_por uuid references usuarios(id),

  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  excluido_em timestamptz,
  excluido_por uuid references usuarios(id),

  constraint conclusao_coerente check (
    (status = 'concluida') = (concluida_em is not null)
  )
);

create index tarefas_responsavel_idx
  on tarefas (responsavel_id, data_limite)
  where status in ('aberta', 'em_andamento') and excluido_em is null;
create index tarefas_processo_idx
  on tarefas (processo_id) where excluido_em is null;
create index tarefas_prazo_idx
  on tarefas (prazo_id) where prazo_id is not null;

-- ----------------------------------------------------------------------------
-- Triggers
-- ----------------------------------------------------------------------------

create trigger prazos_atualizado_em before update on prazos
  for each row execute function app.tocar_atualizado_em();
create trigger tarefas_atualizado_em before update on tarefas
  for each row execute function app.tocar_atualizado_em();

create trigger publicacoes_escritorio_imutavel before update on publicacoes
  for each row execute function app.escritorio_id_imutavel();
create trigger prazos_escritorio_imutavel before update on prazos
  for each row execute function app.escritorio_id_imutavel();
create trigger tarefas_escritorio_imutavel before update on tarefas
  for each row execute function app.escritorio_id_imutavel();

create trigger publicacoes_tenant_processo
  before insert or update on publicacoes
  for each row execute function app.coerencia_tenant_filho('processo_id', 'processos');
create trigger prazos_tenant_processo
  before insert or update on prazos
  for each row execute function app.coerencia_tenant_filho('processo_id', 'processos');
create trigger prazos_tenant_publicacao
  before insert or update on prazos
  for each row execute function app.coerencia_tenant_filho('publicacao_id', 'publicacoes');
create trigger tarefas_tenant_processo
  before insert or update on tarefas
  for each row execute function app.coerencia_tenant_filho('processo_id', 'processos');
create trigger tarefas_tenant_prazo
  before insert or update on tarefas
  for each row execute function app.coerencia_tenant_filho('prazo_id', 'prazos');

-- A data sugerida é imutável depois de gravada, e isso é constraint e não
-- disciplina. Ela existe para ser comparada com a que o advogado confirmou;
-- um UPDATE nela — por reprocessamento, por script de correção, por engano —
-- apagaria a divergência que revela regra errada. Reprocessar cancela a
-- sugestão e cria outra; não reescreve a anterior.
create or replace function app.sugestao_imutavel()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.data_vencimento_sugerida is not null
     and new.data_vencimento_sugerida is distinct from old.data_vencimento_sugerida
  then
    raise exception
      'data_vencimento_sugerida é imutável: a divergência entre o sugerido e '
      'o confirmado é o que revela regra de prazo errada. Corrija em '
      'data_vencimento_confirmada, ou cancele e emita nova sugestão'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger prazos_sugestao_imutavel before update on prazos
  for each row execute function app.sugestao_imutavel();

-- ----------------------------------------------------------------------------
-- Grants e RLS
-- ----------------------------------------------------------------------------

grant select, insert, update on publicacoes, prazos, tarefas to authenticated;

alter table publicacoes enable row level security;
alter table prazos enable row level security;
alter table tarefas enable row level security;
alter table publicacoes force row level security;
alter table prazos force row level security;
alter table tarefas force row level security;

-- --- publicacoes ---

-- Publicação chega pela OAB do escritório e antes de casar com processo, então
-- a visibilidade não pode depender de processo: a fila de triagem é
-- justamente a das que não casaram. O recorte é quem enxerga o escritório
-- todo — é trabalho de responsável e de secretaria.
--
-- O cliente do portal não tem policy aqui. A publicação traz o texto integral
-- do ato, inclusive de processo que não é dele, e por construção
-- escritorio_atual() já devolveria NULL para ele.
create policy publicacoes_leitura_interna on publicacoes
  for select to authenticated
  using (
    escritorio_id = app.escritorio_atual()
    and app.enxerga_escritorio_todo()
  );

-- Escrita normal é da Edge Function, com service_role. A policy existe para o
-- lançamento manual, quando o advogado recebe intimação por outro meio.
create policy publicacoes_escrita_interna on publicacoes
  for insert to authenticated
  with check (
    escritorio_id = app.escritorio_atual()
    and app.enxerga_escritorio_todo()
  );

create policy publicacoes_atualizacao_interna on publicacoes
  for update to authenticated
  using (
    escritorio_id = app.escritorio_atual()
    and app.enxerga_escritorio_todo()
  )
  with check (escritorio_id = app.escritorio_atual());

-- --- prazos ---

-- Herda a visibilidade do processo, pelo EXISTS que passa pela RLS de
-- `processos`. Mais uma alternativa: o prazo atribuído a mim é meu, mesmo em
-- processo em que eu não estou na equipe — delegar um prazo sem dar acesso a
-- ele produziria uma tarefa impossível de cumprir.
create policy prazos_leitura on prazos
  for select to authenticated
  using (
    escritorio_id = app.escritorio_atual()
    and excluido_em is null
    and (
      exists (select 1 from processos p where p.id = prazos.processo_id)
      or responsavel_id = auth.uid()
    )
  );

create policy prazos_escrita on prazos
  for insert to authenticated
  with check (
    escritorio_id = app.escritorio_atual()
    and exists (select 1 from processos p where p.id = prazos.processo_id)
  );

create policy prazos_atualizacao on prazos
  for update to authenticated
  using (
    escritorio_id = app.escritorio_atual()
    and excluido_em is null
    and (
      exists (select 1 from processos p where p.id = prazos.processo_id)
      or responsavel_id = auth.uid()
    )
  )
  with check (escritorio_id = app.escritorio_atual());

-- Confirmar prazo é ato de advogado. A secretaria cadastra e organiza, mas o
-- briefing dá a confirmação ao advogado — e o estagiário, que cumpre tarefa,
-- não assume responsabilidade profissional por data de vencimento.
--
-- É trigger e não policy porque o que se restringe é a transição de status, e
-- policy autoriza a linha inteira: pela policy, quem pode atualizar o prazo
-- para trocar o responsável poderia também confirmá-lo.
create or replace function app.confirmacao_e_ato_de_advogado()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- INSERT também passa por aqui, e tem que passar: a constraint de tabela
  -- garante que um compromisso tenha confirmado_por preenchido, mas não que
  -- seja o nome de quem está inserindo. Sem cobrir o INSERT, gravar um prazo
  -- já confirmado no nome de um colega continuaria possível — e o requisito é
  -- confirmação de um humano IDENTIFICADO, não de um nome qualquer no campo.
  if tg_op = 'UPDATE' and new.status = old.status then
    return new;
  end if;

  if new.status in ('confirmado', 'ajustado')
     and app.papel_atual() not in ('advogado_responsavel', 'advogado_associado')
  then
    raise exception
      'confirmar prazo é ato de advogado: o papel % não pode transformar '
      'sugestão em compromisso', coalesce(app.papel_atual()::text, 'desconhecido')
      using errcode = 'insufficient_privilege';
  end if;

  -- Quem confirma é quem está logado. Sem isto, a confirmação poderia ser
  -- registrada no nome de um colega, e a trilha apontaria para a pessoa errada
  -- justamente no registro que existe para atribuir responsabilidade.
  if new.status in ('confirmado', 'ajustado')
     and new.confirmado_por is distinct from auth.uid()
     -- service_role (a rotina) não tem auth.uid(), e também não confirma
     -- prazo: cai na exceção acima, porque papel_atual() é NULL.
  then
    raise exception
      'confirmado_por tem que ser quem está confirmando'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

create trigger prazos_confirmacao_advogado
  before insert or update on prazos
  for each row execute function app.confirmacao_e_ato_de_advogado();

-- --- tarefas ---

-- A tarefa atribuída a mim é minha, com processo ou sem. É como o estagiário
-- recebe trabalho sem receber o escritório.
create policy tarefas_leitura on tarefas
  for select to authenticated
  using (
    escritorio_id = app.escritorio_atual()
    and excluido_em is null
    and (
      responsavel_id = auth.uid()
      or app.enxerga_escritorio_todo()
      or (processo_id is not null
          and exists (select 1 from processos p where p.id = tarefas.processo_id))
    )
  );

create policy tarefas_escrita on tarefas
  for insert to authenticated
  with check (escritorio_id = app.escritorio_atual());

create policy tarefas_atualizacao on tarefas
  for update to authenticated
  using (
    escritorio_id = app.escritorio_atual()
    and excluido_em is null
    and (
      responsavel_id = auth.uid()
      or app.enxerga_escritorio_todo()
      or (processo_id is not null
          and exists (select 1 from processos p where p.id = tarefas.processo_id))
    )
  )
  with check (escritorio_id = app.escritorio_atual());
