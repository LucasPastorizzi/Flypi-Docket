-- ============================================================================
-- Prova: o bucket de documentos é recortado por escritório
-- ============================================================================
--
-- O Storage é uma segunda camada de RLS, sobre `storage.objects`, e ela não
-- herda nada das policies de `public`. Bucket sem policy fica aberto para
-- qualquer autenticado — inclusive para o cliente do portal, que baixaria
-- petição de processo alheio sabendo o caminho.
--
-- Este arquivo existe porque a lição dos default privileges foi essa: o que
-- não está no teste não está protegido, mesmo que pareça.
-- ============================================================================

begin;

select plan(7);

select cenario.montar();

-- O caminho carrega o escritório no primeiro segmento. É o que permite à
-- policy decidir sem consultar `documentos` — que não tem linha no instante do
-- upload, porque o arquivo sobe antes de o metadado ser gravado.
insert into storage.objects (bucket_id, name) values
  ('documentos',
   (select escritorio_a from cenario.ids)::text || '/proc-a/peticao.pdf'),
  ('documentos',
   (select escritorio_b from cenario.ids)::text || '/proc-b/contrato.pdf');

select is(
  app.escritorio_do_caminho(
    (select escritorio_a from cenario.ids)::text || '/proc/x.pdf'),
  (select escritorio_a from cenario.ids),
  'o escritório é extraído do primeiro segmento do caminho');

-- Caminho fora do formato não pertence a escritório nenhum, e NULL nega em
-- toda policy. Falhar para o lado fechado é o certo.
select is(app.escritorio_do_caminho('solto.pdf'), null,
  'caminho sem pasta de escritório não resolve para escritório nenhum');
select is(app.escritorio_do_caminho('nao-e-uuid/x.pdf'), null,
  'caminho com pasta inválida não derruba a policy: resolve para NULL');

select teste.entrar_como(id.resp_a) from cenario.ids id;
select is((select count(*) from storage.objects)::int, 1,
  'a equipe do A vê apenas o arquivo do A no bucket');
select is_empty($$
  select id from storage.objects
   where name like (select escritorio_b from cenario.ids)::text || '%'
$$, 'a equipe do A não alcança arquivo do escritório B');

-- A tentativa de subir arquivo para a pasta do vizinho. Sem esta trava, o
-- caminho seria escolhido pelo cliente e bastaria digitar o uuid do outro
-- escritório.
select throws_ok(format($$
  insert into storage.objects (bucket_id, name)
  values ('documentos', %L)
$$, (select escritorio_b from cenario.ids)::text || '/invasao.pdf'),
  '42501', null,
  'a equipe do A não consegue gravar arquivo na pasta do escritório B');
select teste.sair();

-- O cliente do portal não tem policy nenhuma no bucket: o download dele passa
-- por URL assinada gerada no servidor, depois de conferir a concessão e o
-- marcador visivel_portal. Dar leitura direta aqui exigiria repetir, em SQL de
-- storage, a regra de três condições que mora na policy de `documentos`.
select teste.entrar_como(id.portal_a) from cenario.ids id;
select is((select count(*) from storage.objects)::int, 0,
  'o cliente do portal não lê o bucket diretamente');
select teste.sair();

select * from finish();
rollback;
