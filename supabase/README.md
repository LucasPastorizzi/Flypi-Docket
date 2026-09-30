# Banco — como rodar e como provar

Esta pasta é a modelagem de dados do Flypi Docket: as migrations, o
isolamento multi-tenant e as provas dele. Nenhuma tela ainda.

O *por quê* de cada decisão está em dois lugares, e nos dois de propósito:
no comentário da própria migration, junto do DDL que ele explica, e em
[`../docs/MODELAGEM.md`](../docs/MODELAGEM.md) para o que é arquitetura e
não caberia numa tabela específica.

## Rodar a suíte

Precisa de um Postgres alcançável e da extensão `pgtap` instalada nele.
Não precisa de Docker e não precisa de `supabase start`.

```bash
./scripts/db-test.sh
```

O script recria o banco de teste do zero a cada execução, aplica o
ambiente emulado, aplica as migrations em ordem e roda os testes. Recriar
não é zelo excessivo: teste de RLS que herda estado de uma execução
anterior pode passar porque a linha que deveria vazar não existe mais, e
esse é o falso negativo mais caro que existe aqui.

Para rodar um arquivo só:

```bash
./scripts/db-test.sh supabase/tests/02_portal_cliente_final.sql
```

### Preparar a máquina (macOS, sem Docker)

```bash
brew install postgresql@17
git clone --depth 1 --branch v1.3.4 https://github.com/theory/pgtap.git /tmp/pgtap && make -C /tmp/pgtap && make -C /tmp/pgtap install
```

`pgtap` não existe no Homebrew e é compilado do fonte — são um Makefile e
arquivos SQL, sem dependência além do `pg_config`.

A versão é fixada na mesma tag que o CI usa. Sem `--branch`, o clone pega o
branch default, que já se anuncia como a versão seguinte antes de ela ser
lançada — e aí a suíte roda contra um pgTAP na máquina de quem desenvolve e
contra outro no CI, o que faz divergência de resultado parecer defeito do
schema.

Subir um cluster descartável, separado do cluster padrão da máquina:

```bash
initdb -D /tmp/flypi-pg -U postgres --locale=C -E UTF8 && pg_ctl -D /tmp/flypi-pg -o "-p 55432 -c unix_socket_directories= -c listen_addresses=127.0.0.1" -l /tmp/flypi-pg/server.log start
```

O `unix_socket_directories=` vazio evita o limite de 103 bytes no caminho
do socket, que estoura com diretório temporário de nome longo.

## O que a suíte prova

| Arquivo | Prova |
|---|---|
| `tests/00_convencao_multitenant.sql` | Toda tabela tem `escritorio_id`, RLS e FORCE — inclusive as que ainda não foram escritas |
| `tests/01_isolamento_entre_escritorios.sql` | Dois escritórios no mesmo banco não enxergam nada um do outro |
| `tests/02_portal_cliente_final.sql` | O cliente final vê só os processos em que é parte, e nada mais |
| `tests/03_seguranca_das_funcoes.sql` | Nenhuma função `SECURITY DEFINER` com `search_path` aberto |
| `tests/04_idempotencia_e_confirmacao.sql` | Publicação repetida não duplica prazo; prazo só vira compromisso com humano identificado |
| `tests/05_sigilo_e_auditoria.sql` | Processo sigiloso não sai por `SELECT`, e todo acesso a ele fica registrado |

O arquivo `00` é o que protege o futuro. Os outros testam o que existe
hoje; ele testa a regra, varrendo o catálogo do Postgres. Tabela nova é
violação até alguém declarar a exceção com motivo escrito — e a
declaração aparece no diff, para ser discutida na revisão em vez de
passar em silêncio.

## O que ainda não foi executado

`tests/integracao/` roda contra um projeto Supabase de verdade, pela API
HTTP, com usuários autenticados pelo GoTrue. Ele cobre o que a suíte de
banco não alcança — a anon key, o PostgREST, a emissão de JWT — e **não
foi executado**: exige um projeto Supabase (local com Docker, ou um de
staging). As instruções estão no cabeçalho do arquivo.

## O que ainda não existe, e por que não

**Nenhum dado de referência** (`seed.sql`). Faltam o catálogo de
tribunais, os feriados nacionais e as regras de prazo — e faltam de
propósito. Preencher a tabela de regras exige um advogado ratificando cada
linha, e preencher o calendário exige conferir portaria de tribunal. A
equipe não tem competência para nenhuma das duas coisas, e um seed
plausível é pior que um vazio: o vazio faz o sistema devolver "ato não
catalogado", e o plausível faz ele devolver uma data errada com cara de
certa.

**A função de cálculo de prazo.** Depende do termo inicial da contagem,
que é a pendência jurídica registrada em `docs/MODELAGEM.md`.
