# Flypi Docket — briefing de arquitetura

> Sistema de gestão para escritórios de advocacia. Produto da Flypi
> Enterprise. Este documento é a fonte da verdade do escopo e das
> decisões já tomadas.

## Seu papel

Você é o desenvolvedor sênior responsável por este sistema, do desenho à
entrega. Trabalhe como quem vai manter o código por três anos: decisões
explicadas no próprio código, nada de mágica, nada de dependência que não
se justifique.

**Antes de escrever qualquer linha, leia este documento inteiro e faça as
perguntas que ficarem em aberto.** Não invente regra de negócio: em
software jurídico, um palpite errado sobre prazo vira dano ao cliente do
nosso cliente.

## O produto

SaaS multi-tenant para escritórios de advocacia de 1 a 10 advogados no
Brasil. O sistema monitora publicações oficiais, calcula prazos
processuais, organiza os processos e dá ao cliente final um portal para
acompanhar o próprio caso.

### Usuários e o que cada um precisa

| Perfil | O que faz no sistema |
|---|---|
| Advogado responsável | Vê prazos do escritório, confirma cálculos, delega |
| Advogado associado / estagiário | Vê só o que é dele, cumpre tarefas |
| Secretaria | Cadastra processo e cliente, organiza documentos |
| Cliente final (portal) | Consulta o andamento do próprio processo e boletos |

### O que este sistema NÃO é

- Não é editor de petição nem gerador de peça por IA
- Não é ferramenta de captação de clientes (a publicidade da advocacia é
  restrita pela OAB — não construa nada que force esse limite)
- Não é sistema contábil

## Regras de domínio — a parte que não pode errar

### 1. Prazo processual

O núcleo do produto e a principal fonte de risco.

- Prazo processual conta em **dias úteis** (art. 219 do CPC); prazo
  material conta em dias corridos. O sistema precisa saber a diferença.
- Contagem **exclui o dia do começo e inclui o do vencimento**.
- Suspende no recesso forense (20/12 a 20/01) e em feriados forenses, que
  **variam por tribunal** e saem por portaria durante o ano.
- Prazo em dobro para litisconsortes com procuradores distintos,
  Defensoria e Fazenda Pública.

**Requisito inegociável:** o sistema **sugere** o prazo e exige
confirmação humana antes de ele virar compromisso. Nada de cálculo
automático silencioso na primeira versão — o advogado vai confiar, e um
erro nosso vira responsabilidade profissional dele.

**Feriados ficam em tabela no banco, nunca em código.** Portaria de
tribunal sai no meio do ano; se depender de deploy, um esquecimento vira
prazo perdido.

### 2. Publicações

- A fonte são as **APIs públicas do CNJ** (Comunicações do DJEN e
  DataJud). Verifique a documentação atual antes de desenhar — formato e
  limites mudam.
- **Proibido raspar site de tribunal.** É frágil e juridicamente cinzento.
- A busca é por número de OAB, e um advogado pode ter inscrição em mais de
  uma seccional.
- Publicação chega uma vez; o sistema precisa ser **idempotente** — a
  mesma publicação processada duas vezes não pode gerar dois prazos.

### 3. Sigilo

Os dados incluem processos em segredo de justiça. Trate como dado
sensível, não como dado de CRM.

## Arquitetura — decisões já tomadas

Não reabra estas escolhas; se discordar de alguma, diga o porquê antes de
implementar.

- **Front-end:** React + TypeScript + Vite + Tailwind
- **Banco e autenticação:** Postgres no Supabase, com RLS
- **Servidor:** Supabase Edge Functions (Deno), para o que exige segredo
- **Rotinas:** função agendada, diária em dia útil de manhã
- **SaaS, não instalação no cliente:** uma base, isolamento por RLS

A pilha não é negociável por preferência pessoal: é a que a equipe já
mantém em produção (o CRM da Flypi roda nela). Três pessoas não sustentam
duas pilhas.

### Multi-tenant desde a primeira migration

Toda tabela de domínio tem `escritorio_id`, e toda policy de RLS filtra
por ele. Não deixe isolamento para depois: acrescentar com dado real de
escritórios diferentes dentro é das migrações mais perigosas que existem.

O cliente final acessa o mesmo banco com papel próprio, enxergando **só os
processos em que ele é parte**. Escreva essa policy com cuidado redobrado
e teste-a explicitamente.

### O robô de publicações: fila, não laço

```
1. Buscar publicações novas na API  ->  gravar cruas, sem interpretar
2. Processar em lotes               ->  identificar processo e tipo de ato
3. Sugerir prazo                    ->  criar tarefa pendente de confirmação
4. Notificar                        ->  WhatsApp e e-mail do responsável
```

Gravar cru antes de interpretar permite **reprocessar** quando uma regra
de prazo for corrigida — e ela vai ser. Processar tudo numa invocação
estoura o tempo limite da função.

## Modelagem — as entidades que eu espero ver

Desenhe o schema completo, mas no mínimo:

`escritorios` · `usuarios` (com papel) · `clientes` · `processos` ·
`partes` · `publicacoes` (cruas) · `prazos` (com origem, status de
confirmação e responsável) · `tarefas` · `documentos` · `honorarios` ·
`feriados` (por tribunal) · `auditoria`

Regras:

- `auditoria` registra quem viu e quem alterou o quê. Em dado sob sigilo,
  log de acesso não é luxo.
- Nada é apagado de verdade: exclusão é lógica, com data e autor.
- Valores monetários em `numeric`, nunca `float`.
- Datas de prazo em `date`; instantes em `timestamptz`.

## Requisitos não-funcionais

- **LGPD:** base legal declarada por finalidade, prazo de descarte
  definido, e um jeito de atender pedido de acesso e exclusão.
- **Backup:** diário, com restauração testada — não basta existir.
- **Segredos** só em variáveis de ambiente do servidor; nada de chave com
  poder de escrita no bundle do navegador.
- **Acessibilidade:** navegação por teclado e leitor de tela funcionando.
  O público inclui advogados com baixa visão.

## Como trabalhar neste projeto

1. **Pergunte antes de assumir.** Regra de negócio sem certeza é pergunta,
   não palpite.
2. **Um commit por passo**, com mensagem que explica *por que*, não *o
   quê* — o diff já mostra o quê.
3. **Comente o código onde a decisão não é óbvia**, principalmente no
   cálculo de prazo: escreva o artigo de lei que sustenta cada regra.
4. **Teste o que dói:** cálculo de prazo, isolamento entre escritórios e
   acesso do cliente final ao portal. Esses três têm teste automatizado
   obrigatório.
5. **Verifique antes de dizer que funciona.** Rode, abra a tela, mostre a
   evidência.

## Critérios de aceite do MVP

- [ ] Dois escritórios no mesmo banco não enxergam nada um do outro
      (provado por teste, não por inspeção)
- [ ] Cliente final vê só os processos em que é parte
- [ ] Publicação nova vira prazo sugerido, com o responsável notificado
- [ ] A mesma publicação processada duas vezes não duplica prazo
- [ ] Prazo só vira compromisso depois de confirmação humana
- [ ] Feriado novo é cadastrado pela interface, sem deploy
- [ ] Todo acesso a processo sob sigilo fica registrado

## Por onde começar

Comece pela **modelagem de dados e pelo RLS**, e apresente antes de
construir tela. É a decisão mais cara de mudar depois, e é onde um erro
vira vazamento entre escritórios.

## Risco conhecido, registrado de propósito

A equipe da Flypi **não é formada por advogados**. O maior risco deste
projeto não é técnico: é errar regra processual por não conhecer a
prática. Antes do MVP sair do papel, é preciso um advogado disposto a
revisar as regras de prazo — de preferência como sócio de produto, não
como entrevistado ocasional.
