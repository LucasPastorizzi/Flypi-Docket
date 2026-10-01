-- ============================================================================
-- Storage: o bucket dos documentos e as policies dele
-- ============================================================================
--
-- O Storage do Supabase é outra camada de RLS, sobre `storage.objects`, e ela
-- NÃO herda nada das policies de `public`. Um bucket criado sem policy fica
-- aberto para qualquer autenticado — inclusive para o cliente do portal, que
-- baixaria petição de processo alheio sabendo o caminho.
--
-- A decisão central: o caminho do arquivo CARREGA o escritório, no primeiro
-- segmento (`<escritorio_id>/<processo_id>/<arquivo>`). Isso permite que a
-- policy decida pelo próprio caminho, sem consultar a tabela `documentos` —
-- que ainda não tem linha no instante do upload, porque o arquivo sobe antes
-- de o metadado ser gravado.
--
-- O bucket é privado. Download passa por URL assinada, gerada pelo servidor
-- com validade curta: link público de documento processual é link que vaza em
-- encaminhamento de e-mail e continua valendo.
-- ============================================================================

insert into storage.buckets (id, name, public)
values ('documentos', 'documentos', false)
on conflict (id) do nothing;

-- O primeiro segmento do caminho, que é o escritório dono do arquivo.
-- `storage.foldername` devolve os segmentos como array.
create or replace function app.escritorio_do_caminho(p_nome text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  return (storage.foldername(p_nome))[1]::uuid;
exception when others then
  -- Caminho fora do formato esperado não pertence a escritório nenhum, e NULL
  -- nega em toda policy. Falhar para o lado fechado é o certo aqui.
  return null;
end;
$$;

-- --- leitura pela equipe ---

-- Quem é do escritório lê os arquivos do escritório. O recorte fino — quais
-- processos cada um vê — fica na tabela `documentos`, que é por onde a
-- aplicação lista; aqui a trava é de tenant, que é o que o Storage consegue
-- decidir barato e sem consultar outras tabelas.
create policy documentos_leitura_equipe on storage.objects
  for select to authenticated
  using (
    bucket_id = 'documentos'
    and app.escritorio_do_caminho(name) = app.escritorio_atual()
  );

create policy documentos_envio_equipe on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'documentos'
    and app.escritorio_do_caminho(name) = app.escritorio_atual()
  );

create policy documentos_atualizacao_equipe on storage.objects
  for update to authenticated
  using (
    bucket_id = 'documentos'
    and app.escritorio_do_caminho(name) = app.escritorio_atual()
  );

-- Sem policy de DELETE, como no resto do sistema: documento juntado a processo
-- não se apaga. A exclusão é lógica, em `documentos`, e o arquivo fica.

-- --- o portal ---

-- O cliente final NÃO recebe policy aqui, e é deliberado.
--
-- `app.escritorio_atual()` já devolve NULL para ele, então as policies acima
-- negam por construção. Mas a ausência é dupla: o download do portal passa
-- por URL assinada gerada no servidor, depois de a Edge Function conferir a
-- concessão e o marcador `visivel_portal` do documento — e registrar o
-- acesso, quando o processo é sigiloso.
--
-- Dar ao portal uma policy de leitura direta no Storage teria que repetir
-- aqui, em SQL de storage, a regra de três condições que mora na policy de
-- `documentos`. Duas cópias divergem, e a que divergir para o lado permissivo
-- entrega documento de processo alheio.
