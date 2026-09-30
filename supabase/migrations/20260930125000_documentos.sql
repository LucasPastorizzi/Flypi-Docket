-- ============================================================================
-- Documentos
-- ============================================================================
--
-- Só metadado: o arquivo vive no Supabase Storage, e esta tabela guarda onde
-- ele está e o que ele é. Guardar bytes em coluna do Postgres inflaria o
-- backup do banco — que precisa ser diário e com restauração testada — com
-- conteúdo que já tem armazenamento próprio, e tornaria cada restore de teste
-- proibitivamente lento. Backup lento é backup que se testa menos.
-- ============================================================================

create table documentos (
  id uuid primary key default gen_random_uuid(),
  escritorio_id uuid not null references escritorios(id) on delete restrict,

  -- Um dos dois, ou os dois. Procuração é do cliente e não de um processo;
  -- petição é do processo. Exigir processo_id obrigaria a pendurar o documento
  -- do cliente num processo arbitrário.
  processo_id uuid references processos(id) on delete restrict,
  cliente_id uuid references clientes(id) on delete restrict,
  check (processo_id is not null or cliente_id is not null),

  -- Onde o arquivo está no Storage. Caminho e bucket em colunas separadas
  -- porque a política de bucket é o que separa o que pode ser servido por URL
  -- assinada do que não pode, e misturar os dois num campo só faria essa
  -- distinção depender de parsing de string.
  bucket text not null,
  caminho text not null,

  nome_original text not null,
  mime text,

  -- bigint e não integer: integer estoura em 2 GB, e vídeo de audiência passa
  -- disso sem esforço.
  tamanho_bytes bigint check (tamanho_bytes is null or tamanho_bytes >= 0),

  -- Identifica o conteúdo. Serve para detectar reenvio do mesmo arquivo e,
  -- mais importante, para provar que o documento não mudou desde que foi
  -- juntado — o que é a pergunta que importa quando um documento é usado em
  -- processo.
  hash_sha256 text check (hash_sha256 is null or hash_sha256 ~ '^[0-9a-f]{64}$'),

  -- Sigilo do documento, independente do sigilo do processo: existe documento
  -- sensível em processo público (laudo médico, extrato bancário), e o inverso
  -- também.
  sigiloso boolean not null default false,

  -- O interruptor do portal, e o default é o que importa aqui. Documento não
  -- chega ao cliente por omissão: liberar é ato deliberado. Com default true, o
  -- primeiro rascunho de petição enviado ao processo apareceria no portal antes
  -- de o advogado decidir que podia.
  visivel_portal boolean not null default false,

  enviado_por uuid references usuarios(id),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  excluido_em timestamptz,
  excluido_por uuid references usuarios(id),

  -- Documento sigiloso nunca vai ao portal por SELECT. O cliente que é parte
  -- tem direito a documento do próprio caso, mas esse acesso passa pela Edge
  -- Function que gera a URL assinada e registra o acesso — pela mesma razão
  -- que a leitura de processo sigiloso passa por RPC: é a única forma de o log
  -- ser garantia.
  constraint sigiloso_nao_vai_ao_portal check (not (sigiloso and visivel_portal)),

  unique (bucket, caminho)
);

create index documentos_processo_idx
  on documentos (processo_id) where excluido_em is null;
create index documentos_cliente_idx
  on documentos (cliente_id) where excluido_em is null;

create trigger documentos_atualizado_em before update on documentos
  for each row execute function app.tocar_atualizado_em();
create trigger documentos_escritorio_imutavel before update on documentos
  for each row execute function app.escritorio_id_imutavel();
create trigger documentos_tenant_processo
  before insert or update on documentos
  for each row execute function app.coerencia_tenant_filho('processo_id', 'processos');
create trigger documentos_tenant_cliente
  before insert or update on documentos
  for each row execute function app.coerencia_tenant_filho('cliente_id', 'clientes');

grant select, insert, update on documentos to authenticated;

alter table documentos enable row level security;
alter table documentos force row level security;

-- Herda a visibilidade do processo, quando há processo. Documento solto do
-- cliente segue o recorte de `clientes`: quem enxerga o escritório todo.
create policy documentos_leitura_interna on documentos
  for select to authenticated
  using (
    escritorio_id = app.escritorio_atual()
    and excluido_em is null
    and not sigiloso
    and (
      (processo_id is not null
       and exists (select 1 from processos p where p.id = documentos.processo_id))
      or (processo_id is null and app.enxerga_escritorio_todo())
    )
  );

create policy documentos_escrita_interna on documentos
  for insert to authenticated
  with check (
    escritorio_id = app.escritorio_atual()
    and (
      (processo_id is not null
       and exists (select 1 from processos p where p.id = documentos.processo_id))
      or (processo_id is null and app.enxerga_escritorio_todo())
    )
  );

create policy documentos_atualizacao_interna on documentos
  for update to authenticated
  using (
    escritorio_id = app.escritorio_atual()
    and excluido_em is null
    and not sigiloso
    and (
      (processo_id is not null
       and exists (select 1 from processos p where p.id = documentos.processo_id))
      or (processo_id is null and app.enxerga_escritorio_todo())
    )
  )
  with check (escritorio_id = app.escritorio_atual());

-- --- o portal ---

-- Três condições juntas, e nenhuma delas dispensável: o processo tem que ter
-- concessão viva, o documento tem que estar marcado como visível, e não pode
-- ser sigiloso. O marcador é por documento porque o processo ser do cliente
-- não faz todo papel do processo ser dele — anotação interna, minuta e
-- estratégia moram no mesmo processo que a sentença.
create policy documentos_leitura_portal on documentos
  for select to authenticated
  using (
    excluido_em is null
    and visivel_portal
    and not sigiloso
    and processo_id in (select app.processos_do_portal())
  );
