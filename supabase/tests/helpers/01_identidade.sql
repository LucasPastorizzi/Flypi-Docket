-- ============================================================================
-- Troca de identidade nos testes
-- ============================================================================
--
-- Também não é migration. Vive num schema separado (`teste`) para que fique
-- impossível confundir com código de produção.
--
-- O ponto importante: autenticar aqui é fazer o mesmo que o PostgREST faz —
-- SET ROLE authenticated mais o JWT em request.jwt.claims. Um helper que
-- simulasse identidade de outra forma provaria outra coisa que não o
-- comportamento real, e o que precisa de prova aqui é justamente o real.
-- ============================================================================

create schema if not exists teste;

create or replace function teste.entrar_como(p_usuario uuid)
returns void
language plpgsql
as $$
begin
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', p_usuario::text, 'role', 'authenticated')::text,
    true  -- local à transação: o teste não contamina a conexão
  );
  set local role authenticated;
end;
$$;

-- Visitante: sem JWT e no role anon. Serve para provar que nenhuma tabela de
-- domínio responde para quem não se autenticou.
create or replace function teste.entrar_como_visitante()
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', '', true);
  set local role anon;
end;
$$;

-- Volta ao role de migration. Usado entre os blocos de asserção para semear
-- dados sem que o próprio RLS atrapalhe a montagem do cenário.
create or replace function teste.sair()
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', '', true);
  reset role;
end;
$$;

grant usage on schema teste to anon, authenticated;
grant execute on all functions in schema teste to anon, authenticated;

-- Conta quantas linhas um comando de escrita realmente afetou.
--
-- Existe porque RLS não recusa UPDATE em linha alheia com erro: a linha
-- simplesmente não entra no conjunto que o USING autoriza, e o comando afeta
-- zero linhas. Essa é a resposta certa — erro revelaria que a linha existe —,
-- mas significa que a asserção tem que olhar a contagem, e não a ausência de
-- exceção.
--
-- SECURITY INVOKER (o padrão): a identidade de quem chama é a que vale, senão
-- a função testaria os privilégios do próprio dono.
create or replace function teste.linhas_afetadas(p_comando text)
returns integer
language plpgsql
as $$
declare
  n integer;
begin
  execute p_comando;
  get diagnostics n = row_count;
  return n;
end;
$$;

grant execute on all functions in schema teste to anon, authenticated;
