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
│                                        de busca no DJEN
├── clientes
│   └── usuarios_portal (PK = auth.users.id)
│                                        login do cliente final; um cliente
│                                        PJ pode ter várias pessoas
├── processos
│   ├── partes ....................... polo ativo/passivo/terceiro. A parte
│   │                                   adversa também é linha aqui, e o
│   │                                   cliente_id fica nulo nela
│   ├── processos_equipe ............. quem do escritório trabalha no caso
│   ├── acessos_portal ............... concessão explícita ao cliente final
│   ├── publicacoes .................. cruas, payload jsonb intacto
│   ├── prazos ....................... sugerido ≠ confirmado, em colunas
│   │   │                               separadas
│   │   └── tarefas .................. N tarefas por prazo, e tarefa sem prazo
│   └── documentos ................... metadado; arquivo no Storage
└── feriados_escritorio .............. exceções locais do calendário

feriados ............................. catálogo global curado pela Flypi
tipos_ato ── regras_prazo ............ catálogo de prazos, ratificado por
                                        advogado, versionado por vigência
auditoria ............................ append-only, UPDATE/DELETE revogados
finalidades_tratamento ............... base legal e prazo de descarte (LGPD)
solicitacoes_titular ................. pedidos de acesso e exclusão (LGPD)
```

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

## Prova de isolamento

Duas camadas, ambas executáveis:

1. **pgTAP no banco** (`supabase/tests/`). Semeia dois escritórios e um
   cliente final, troca de identidade com `request.jwt.claims` e afirma o
   que cada um vê. Inclui uma varredura do catálogo que reprova qualquer
   tabela de domínio sem RLS ou sem `escritorio_id`.
2. **Integração via supabase-js**, com usuários realmente autenticados,
   cobrindo o caminho da anon key — o que o navegador de fato faz.

Toda asserção de vazamento é testada pela negativa: buscar processo alheio
por id direto retorna zero linhas. Não é erro de permissão, é conjunto
vazio — que é o comportamento certo, porque erro de permissão já vaza a
informação de que o id existe.
