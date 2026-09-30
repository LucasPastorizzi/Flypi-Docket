# Flypi Docket — modelagem de dados e isolamento

Este documento registra as decisões de modelagem e as decisões de
isolamento multi-tenant, com a justificativa de cada uma. As migrations
são a fonte da verdade do *como*; este documento é a fonte do *por quê* em
nível de arquitetura, e do que ficou pendente.

Escopo desta entrega: schema, RLS e prova de isolamento. Nenhuma tela.

## Decisões ratificadas

Estas foram apresentadas e decididas antes da primeira migration. Estão
aqui para que quem pegar o projeto em 2029 saiba que não foram acidente.

| Decisão | Escolha | Por quê |
|---|---|---|
| Acesso do portal | Tabela de vínculo explícito (`acessos_portal`) | Derivar acesso de CPF da parte transforma erro de digitação da secretaria em vazamento silencioso, e homônimo em vazamento. O vínculo explícito tem autor, data e revogação, e a policy vira um teste de existência de linha viva — fácil de ler, fácil de testar. |
| Feriados | Catálogo global curado pela Flypi + `feriados_escritorio` para exceções | Portaria de tribunal vale para todos os escritórios daquele tribunal; deixar cada um cadastrar a sua produz cálculos divergentes para o mesmo prazo. A tabela de exceções preserva o critério de aceite "feriado novo sem deploy". |
| Auditoria de leitura de sigiloso | RPC obrigatória: policy nega `SELECT` direto, leitura passa por função `SECURITY DEFINER` que grava o acesso | Postgres não tem trigger de `SELECT`. Log na aplicação é best-effort: um bug, um cliente alternativo ou uma consulta pelo painel do Supabase leriam sem rastro. Em dado sob segredo de justiça, a garantia tem que estar no banco. |
| Usuário × escritório | 1:1, `usuarios.escritorio_id NOT NULL` | Mantém `escritorio_atual()` num lookup por chave primária e as policies sem contexto de sessão. A camada de isolamento é o pior lugar para ganhar flexibilidade que ninguém pediu. Correspondente entra como usuário separado em cada escritório. |
| Escopo de associado/estagiário | Atribuição explícita via `processos_equipe` | "Só o que é dele" derivado de tarefa em aberto faz o acesso aparecer e desaparecer conforme as tarefas fecham. Derivado só do responsável impede duas pessoas no mesmo caso. |
| Publicações | Uma cópia por escritório (`publicacoes.escritorio_id NOT NULL`) | Dois escritórios nossos podem atuar em lados opostos do mesmo processo. Linha global exigiria uma tabela de domínio sem `escritorio_id` — exceção exatamente na camada que precisa ser uniforme. O custo é jsonb duplicado, que é barato. |
| Resolução do tenant nas policies | Função `escritorio_atual()`, `STABLE SECURITY DEFINER` | A alternativa (claim `escritorio_id` no JWT via Custom Access Token Hook) evita o lookup, mas fica obsoleta até o token expirar: revogar acesso não teria efeito imediato. Não é trade-off aceitável com dado sigiloso, e o custo evitado é um index scan em chave primária. `SECURITY DEFINER` também é o que impede recursão na policy de `usuarios`. |
| Papel de administração | Flag `admin_escritorio` acumulável, separada do papel funcional | Competência técnica (convidar usuário, conceder portal) não é competência processual. A secretaria pode administrar sem virar advogada no sistema, e o advogado não é obrigado a fazer cadastro. |

## Divergência deliberada do briefing

`honorarios` está na lista de entidades mínimas do briefing, e o portal do
cliente final deveria mostrar boletos. **Ficou fora desta entrega por
decisão do responsável pelo produto.** Consequência registrada: o portal
não terá a aba de cobrança no MVP, e o critério do briefing sobre boletos
fica em aberto. Quando entrar, entra como `honorarios` +
`honorarios_parcelas` com `numeric(14,2)`, seguindo o mesmo padrão de RLS
das demais tabelas de domínio — não é migration de risco, porque não
altera tabela com dado vivo.

## Pendência jurídica — não é decisão de engenharia

O **termo inicial da contagem** não está fixado. Envolve a distinção entre
divulgação e publicação no DJEN e os §§ do art. 224 do CPC, mais o art.
231 para as demais formas de intimação. Ninguém na equipe é advogado, e
esta é precisamente a classe de erro que o briefing registra como risco
maior do projeto.

Consequência no schema, e é uma decisão de engenharia consciente:
`regras_prazo` é dado, não código, e **regra sem ratificação de advogado
não sugere prazo**. O sistema devolve "ato não catalogado, prazo a definir
manualmente". Preferimos não sugerir a sugerir errado — o silêncio é
visível para o advogado, o número errado não é.

## Mapa das tabelas

```
escritorios ........................... a raiz do tenant, sem escritorio_id
├── usuarios (PK = auth.users.id) ..... equipe interna
│   └── oabs_usuario ................. N inscrições por advogado; é a chave
│                                        de busca no DJEN, e faltar uma
│                                        seccional é publicação não capturada
├── clientes
│   └── usuarios_portal (PK = auth.users.id)
│                                        login do cliente final; um cliente
│                                        PJ pode ter várias pessoas
├── processos
│   ├── partes ....................... polo ativo/passivo/terceiro. A parte
│   │                                   adversa também é linha aqui, com
│   │                                   cliente_id nulo
│   ├── processos_equipe ............. quem do escritório trabalha no caso.
│   │                                   É o que materializa "associado vê só
│   │                                   o que é dele"
│   ├── acessos_portal ............... concessão explícita ao cliente final
│   ├── publicacoes .................. cruas, payload jsonb intacto
│   ├── prazos ....................... sugerido ≠ confirmado, em colunas
│   │   │                               separadas e a sugerida imutável
│   │   └── tarefas .................. N tarefas por prazo, e tarefa sem prazo
│   └── documentos ................... metadado; arquivo no Storage
├── feriados_escritorio .............. exceções locais do calendário
├── solicitacoes_titular ............. pedidos de acesso e exclusão (LGPD)
└── auditoria ........................ append-only; pertence ao escritório do
                                        DADO, não ao do ator

Catálogos globais (sem escritorio_id, escrita por service_role):
  tribunais ......................... sigla, segmento e UF
  feriados .......................... intervalos, por abrangência e efeito
  tipos_ato ── regras_prazo ......... ratificado por advogado, versionado por
                                       vigência. Nasce vazio, por decisão
  finalidades_tratamento ............ base legal e prazo de descarte (LGPD)
```

Cada catálogo global é uma exceção declarada à convenção, com o motivo
escrito dentro de `supabase/tests/00_convencao_multitenant.sql` — não num
comentário solto, mas na lista que o teste consulta. Acrescentar uma
exceção é editar aquele arquivo, e a edição aparece no diff.

## Visibilidade de processo: escrita num lugar

A policy de `processos` é a única definição de quem pode ver um processo.
As tabelas filhas não repetem a regra: perguntam com `exists (select 1
from processos p where p.id = ...)`, e o RLS de `processos` é aplicado
dentro dessa subconsulta. Duas cópias divergem com o tempo, e a que
divergir para o lado permissivo é vazamento.

Há uma exceção, e ela é inevitável: `app.pode_ver_processo()`, usada pela
RPC de leitura auditada. Policy não se consulta como predicado, e a RPC é
`SECURITY DEFINER` e portanto não passa por ela. As duas cópias ficam em
acordo por teste — a suíte compara, para cada perfil do cenário, o
conjunto que a policy entrega com o que a função autoriza.

## O que o portal alcança, e o que não

Alcança: `processos` com concessão viva e sem sigilo, `documentos`
marcados `visivel_portal`, `tribunais`, os catálogos de calendário, e a
própria linha em `usuarios_portal`.

Não alcança: `clientes` (tem as anotações internas do escritório sobre o
próprio cliente, e RLS autoriza linha e não coluna), `partes` (CPF e
qualificação da parte adversa), `prazos` e `tarefas` (estratégia interna),
`publicacoes` (texto integral de atos, inclusive de processos que não são
dele), `acessos_portal` e `auditoria`.

A maior parte disso não precisou de cláusula própria: as policies internas
filtram por `escritorio_id = app.escritorio_atual()`, e essa função
devolve NULL para quem é do portal. Comparação com NULL nega. Tabela de
domínio nova que siga a convenção nasce fechada para o portal.

## Convenções aplicadas em toda tabela de domínio

- `escritorio_id uuid NOT NULL REFERENCES escritorios(id)` — sem exceção.
  A prova de isolamento varre o catálogo do Postgres e falha se aparecer
  tabela de domínio sem a coluna ou sem RLS. Tabela nova mal configurada
  quebra o teste em vez de passar despercebida.
- Exclusão é lógica: `excluido_em timestamptz` e `excluido_por uuid`. As
  policies de leitura filtram `excluido_em IS NULL`, então registro
  excluído desaparece da aplicação sem sair do banco.
- Dinheiro em `numeric`, nunca `float`. Datas de prazo em `date`, porque
  prazo não tem hora e fuso em prazo é fonte de erro. Instantes em
  `timestamptz`.
- Enum do Postgres só para valor que o código examina em `switch` (status,
  polo). Valor que o negócio muda sozinho (tipo de ato, feriado) é linha
  em tabela — o briefing pede isso para feriado, e a razão vale igual para
  regra de prazo.

## O que só apareceu implementando

Quatro coisas que a suíte pegou e que não estavam no desenho. Ficam
registradas porque são armadilhas de RLS no Postgres, não erros deste
schema em particular — a próxima tabela vai enfrentar as mesmas.

**Trigger de integridade sob RLS valida coisas diferentes para pessoas
diferentes.** Função de trigger sem `SECURITY DEFINER` consulta as tabelas
com a identidade de quem está escrevendo. O caso que dói: o trigger que
impede a mesma conta de existir em `usuarios` e `usuarios_portal` não
encontrava a linha quando ela era de outro escritório, porque o admin que
insere não vê o escritório vizinho — a invariante deixava de valer
exatamente no caso cross-tenant que ela existe para cobrir. Integridade
responde sobre o que é fato no banco; autorização é trabalho da policy.

**O Postgres concede `EXECUTE` a PUBLIC em toda função nova.** Não
conceder não basta; é preciso revogar. Sem isso, `app.registrar()` era
chamável por qualquer cliente autenticado, que escreveria na auditoria o
que quisesse — e log forjável é pior que log ausente, porque dá a
impressão de trilha onde não há.

**Constraint garante que o campo está preenchido, não que o valor seja
legítimo.** A constraint de confirmação humana exigia `confirmado_por`, e
o trigger que verifica se é quem está logado só cobria `UPDATE`. Dava para
nascer prazo já confirmado no nome de um colega.

**A linha de auditoria pertence ao escritório do dado, não ao do ator.** A
diferença só aparece quando alguém do A tenta ler processo sigiloso do B —
e é o caso que importa, porque na trilha de A a tentativa ficaria
invisível para quem tem o dever de guarda sobre aquele processo.

## Prova de isolamento

Duas camadas. A primeira está executada e passando; a segunda está escrita
e não executada.

**1. pgTAP no banco — 112 asserções, todas passando.** Roda com
`./scripts/db-test.sh`, contra um Postgres nu, sem Docker. Dois
escritórios simétricos no mesmo banco, mais dois logins de portal, e a
troca de identidade usa o mesmo mecanismo do PostgREST (`SET ROLE
authenticated` mais o JWT em `request.jwt.claims`) — um helper que
simulasse identidade de outra forma provaria o comportamento do helper.

O cenário é simétrico de propósito: com o escritório B vazio, o teste
passaria mesmo com o isolamento quebrado, porque não haveria o que vazar.
E inclui um associado sem atribuição nenhuma, que é o único que distingue
"vê porque foi atribuído" de "vê porque é do escritório".

Toda asserção de vazamento afirma conjunto **vazio**, não erro: erro de
permissão informaria que a linha existe, o que já é um vazamento menor. É
por isso que o UPDATE cross-tenant é medido por linhas afetadas.

Um dos arquivos não testa tabelas, testa a regra: varre o catálogo do
Postgres e reprova qualquer tabela sem `escritorio_id`, sem RLS, sem
FORCE ou sem policy. Tabela nova é violação até alguém declarar a exceção
com motivo escrito. É o que protege as migrations que ainda não existem.

**2. Integração HTTP — escrita, não executada.** Em
`supabase/tests/integracao/`, com `fetch` e sem dependência. Cobre o que a
primeira camada não alcança: a anon key que vai no bundle do navegador, o
PostgREST, o JWT emitido pelo GoTrue. Se a anon key tiver privilégio a
mais ou uma tabela for exposta por engano no schema da API, as policies
continuam corretas e o dado vaza de todo jeito. Exige um projeto Supabase
— local com Docker, ou de staging.

## Próximos passos, em ordem

1. **Rodar a camada 2** contra um Supabase de staging. É o que falta para
   a prova estar completa.
2. **Conseguir o advogado revisor.** O briefing pede isso e a modelagem
   agora depende disso: `regras_prazo` está vazia e o termo inicial da
   contagem segue indefinido. Sem essa pessoa, o produto não tem núcleo.
3. **Verificar a documentação atual das APIs do CNJ** antes de escrever o
   robô — formato e limites mudam, e `publicacoes.id_externo` é nullable
   justamente porque não está confirmado que o DJEN forneça um id estável.
4. **Dado de referência**, curado: tribunais, feriados nacionais e
   forenses. Não antes do item 2, porque o calendário errado é tão
   perigoso quanto a regra errada.
5. Só então a função de cálculo, e só então as telas.
