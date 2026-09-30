-- ============================================================================
-- Prova: publicação repetida não duplica prazo, e prazo só vira compromisso
--        com um humano identificado atrás dele
-- ============================================================================
--
-- Dois critérios de aceite do briefing. Os dois são provados contra o BANCO, e
-- não contra a aplicação, porque é no banco que eles estão garantidos —
-- idempotência checada na Edge Function tem janela quando duas invocações da
-- rotina rodam concorrentes, e regra de confirmação no front não vale para o
-- primeiro script de importação que rodar por fora.
-- ============================================================================

begin;

select plan(14);

select cenario.montar();

insert into tipos_ato (codigo, nome) values
  ('sentenca', 'Sentenca'),
  ('despacho_mero_expediente', 'Despacho de mero expediente');

-- Uma publicação do escritório A, como a rotina gravaria: crua, com id da
-- origem e hash do conteúdo.
insert into publicacoes (
  id, escritorio_id, fonte, id_externo, hash_conteudo, payload,
  numero_cnj, processo_id, tipo_ato, data_divulgacao, data_publicacao
) values (
  '11111111-5555-0000-0000-000000000001',
  (select escritorio_a from cenario.ids), 'djen', 'DJEN-2026-0001',
  'hash-do-conteudo-1', '{"texto": "intimacao da sentenca"}'::jsonb,
  '10000000000000000001', (select processo_a from cenario.ids), 'sentenca',
  '2026-03-02', '2026-03-03'
);

-- ----------------------------------------------------------------------------
-- Idempotência da captura
-- ----------------------------------------------------------------------------

-- Primeiro modo de a mesma publicação voltar: a origem reenvia com o mesmo id.
select throws_ok(format($$
  insert into publicacoes (escritorio_id, fonte, id_externo, hash_conteudo,
                           payload)
  values (%L, 'djen', 'DJEN-2026-0001', 'hash-diferente', '{}'::jsonb)
$$, (select escritorio_a from cenario.ids)),
  '23505', null,
  'a mesma publicação com o mesmo id da origem não entra duas vezes');

-- Segundo modo, e o que segura quando a origem não fornece id estável: a
-- rotina reconsulta a mesma janela de datas e recebe o mesmo conteúdo.
select throws_ok(format($$
  insert into publicacoes (escritorio_id, fonte, hash_conteudo, payload)
  values (%L, 'djen', 'hash-do-conteudo-1', '{}'::jsonb)
$$, (select escritorio_a from cenario.ids)),
  '23505', null,
  'a mesma publicação sem id da origem é barrada pelo hash do conteúdo');

-- E a trava é POR ESCRITÓRIO: os dois atuando em lados opostos do mesmo
-- processo recebem a mesma publicação, e cada um tem direito à sua cópia.
select lives_ok(format($$
  insert into publicacoes (escritorio_id, fonte, id_externo, hash_conteudo,
                           payload)
  values (%L, 'djen', 'DJEN-2026-0001', 'hash-do-conteudo-1', '{}'::jsonb)
$$, (select escritorio_b from cenario.ids)),
  'o outro escritório grava a sua própria cópia da mesma publicação');

-- ----------------------------------------------------------------------------
-- Idempotência do prazo — o critério de aceite
-- ----------------------------------------------------------------------------

insert into prazos (
  escritorio_id, processo_id, origem, publicacao_id, tipo_ato,
  contagem, dias, data_termo_inicial, data_inicio_contagem,
  data_vencimento_sugerida, responsavel_id
) values (
  (select escritorio_a from cenario.ids), (select processo_a from cenario.ids),
  'publicacao', '11111111-5555-0000-0000-000000000001', 'sentenca',
  'dias_uteis', 15, '2026-03-03', '2026-03-04', '2026-03-25',
  (select resp_a from cenario.ids)
);

-- O reprocessamento da mesma publicação — que vai acontecer, porque as
-- publicações são gravadas cruas justamente para permitir reprocessar.
select throws_ok(format($$
  insert into prazos (escritorio_id, processo_id, origem, publicacao_id,
                      tipo_ato, contagem, dias, data_vencimento_sugerida)
  values (%L, %L, 'publicacao', %L, 'sentenca', 'dias_uteis', 15, '2026-03-25')
$$, (select escritorio_a from cenario.ids),
    (select processo_a from cenario.ids),
    '11111111-5555-0000-0000-000000000001'),
  '23505', null,
  'reprocessar a mesma publicação não cria um segundo prazo do mesmo ato');

-- Uma publicação pode comunicar dois atos com prazos distintos, e isso não é
-- duplicação. A chave da idempotência inclui o tipo de ato por isso.
select lives_ok(format($$
  insert into prazos (escritorio_id, processo_id, origem, publicacao_id,
                      tipo_ato, contagem, dias, data_vencimento_sugerida)
  values (%L, %L, 'publicacao', %L, 'despacho_mero_expediente', 'dias_uteis',
          5, '2026-03-10')
$$, (select escritorio_a from cenario.ids),
    (select processo_a from cenario.ids),
    '11111111-5555-0000-0000-000000000001'),
  'a mesma publicação pode gerar prazos de atos diferentes');

-- O fluxo de correção de regra: cancela a sugestão errada, emite a certa. Se o
-- índice não excluísse 'cancelado', corrigir uma regra seria impossível sem
-- apagar histórico.
select lives_ok(format($$
  update prazos set status = 'cancelado'
   where publicacao_id = %L and tipo_ato = 'sentenca'
$$, '11111111-5555-0000-0000-000000000001'),
  'a sugestão pode ser cancelada');

select lives_ok(format($$
  insert into prazos (escritorio_id, processo_id, origem, publicacao_id,
                      tipo_ato, contagem, dias, data_vencimento_sugerida)
  values (%L, %L, 'publicacao', %L, 'sentenca', 'dias_uteis', 15, '2026-03-26')
$$, (select escritorio_a from cenario.ids),
    (select processo_a from cenario.ids),
    '11111111-5555-0000-0000-000000000001'),
  'e a sugestão corrigida entra no lugar, sem apagar a cancelada');

-- ----------------------------------------------------------------------------
-- Confirmação humana — o outro critério de aceite
-- ----------------------------------------------------------------------------

select is((
  select eh_compromisso from prazos
   where publicacao_id = '11111111-5555-0000-0000-000000000001'
     and tipo_ato = 'sentenca' and status = 'sugerido'
), false, 'prazo sugerido não é compromisso');

-- A constraint de tabela: não há status de compromisso sem quem, quando e qual
-- data. Nem pela aplicação, nem por script, nem por service_role.
select throws_ok(format($$
  insert into prazos (escritorio_id, processo_id, origem, contagem, dias,
                      data_vencimento_sugerida, status)
  values (%L, %L, 'manual', 'dias_uteis', 15, '2026-04-01', 'confirmado')
$$, (select escritorio_a from cenario.ids),
    (select processo_a from cenario.ids)),
  '23514', null,
  'não existe prazo confirmado sem quem confirmou, quando, e a data que vale');

-- Confirmar é ato de advogado. A secretaria cadastra e organiza — o briefing
-- dá a confirmação ao advogado, e o estagiário não assume responsabilidade
-- profissional por data de vencimento.
select teste.entrar_como(id.secretaria_a) from cenario.ids id;
select throws_ok(format($$
  update prazos
     set status = 'confirmado', confirmado_por = %L, confirmado_em = now(),
         data_vencimento_confirmada = '2026-03-26'
   where publicacao_id = %L and tipo_ato = 'sentenca' and status = 'sugerido'
$$, (select secretaria_a from cenario.ids),
    '11111111-5555-0000-0000-000000000001'),
  '42501', null,
  'a secretaria não transforma sugestão em compromisso');
select teste.sair();

-- E quem confirma tem que ser quem está logado: confirmação registrada no nome
-- de um colega apontaria a responsabilidade para a pessoa errada justamente no
-- registro que existe para atribuí-la.
select teste.entrar_como(id.resp_a) from cenario.ids id;
select throws_ok(format($$
  update prazos
     set status = 'confirmado', confirmado_por = %L, confirmado_em = now(),
         data_vencimento_confirmada = '2026-03-26'
   where publicacao_id = %L and tipo_ato = 'sentenca' and status = 'sugerido'
$$, (select assoc_a from cenario.ids),
    '11111111-5555-0000-0000-000000000001'),
  '42501', null,
  'o advogado não confirma prazo no nome de um colega');

select lives_ok(format($$
  update prazos
     set status = 'ajustado', confirmado_por = %L, confirmado_em = now(),
         data_vencimento_confirmada = '2026-03-27'
   where publicacao_id = %L and tipo_ato = 'sentenca' and status = 'sugerido'
$$, (select resp_a from cenario.ids),
    '11111111-5555-0000-0000-000000000001'),
  'o advogado confirma, ajustando a data que o sistema sugeriu');

-- A razão de a sugestão ser imutável: é a comparação entre a data sugerida e a
-- confirmada que revela regra de prazo errada. Um UPDATE nela apagaria o único
-- sinal de que o cálculo errou.
select throws_ok(format($$
  update prazos set data_vencimento_sugerida = '2026-03-27'
   where publicacao_id = %L and tipo_ato = 'sentenca'
$$, '11111111-5555-0000-0000-000000000001'),
  '23514', null,
  'a data sugerida não pode ser reescrita para casar com a confirmada');

select teste.sair();

-- Dobrar prazo sem dizer por quê é a mudança de data mais difícil de conferir
-- depois. A constraint cobra o fundamento junto da dobra.
select throws_ok(format($$
  insert into prazos (escritorio_id, processo_id, origem, contagem, dias,
                      em_dobro, data_vencimento_sugerida)
  values (%L, %L, 'manual', 'dias_uteis', 15, true, '2026-04-10')
$$, (select escritorio_a from cenario.ids),
    (select processo_a from cenario.ids)),
  '23514', null,
  'prazo em dobro exige o fundamento da dobra');

select * from finish();
rollback;
