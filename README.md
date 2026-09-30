# Flypi Docket

Sistema de gestão para escritórios de advocacia — o produto jurídico da
Flypi Enterprise.

*Docket* é a pauta do tribunal em inglês jurídico: a lista de casos e
prazos que estão por vir. É o que o sistema entrega — o que vence, quando,
e de quem é.

## O que faz

Monitora as publicações oficiais pelo número da OAB, sugere o prazo
processual correspondente, organiza os processos do escritório e dá ao
cliente final um portal para acompanhar o próprio caso.

## Estado

Modelagem de dados e isolamento multi-tenant entregues, em migrations
comentadas, com o isolamento provado por 112 asserções que rodam em
`./scripts/db-test.sh`. Nenhuma tela ainda — a ordem é a do briefing.

O desenho e as decisões estão em [docs/MODELAGEM.md](docs/MODELAGEM.md);
como rodar as provas, em [supabase/README.md](supabase/README.md).

Duas pendências registradas, não esquecidas: o termo inicial da contagem
de prazo segue sem definição jurídica — e por isso o catálogo de regras
nasce vazio, sem sugerir prazo algum — e a camada de teste que passa pela
API HTTP está escrita mas ainda não executada.

O briefing de arquitetura está em [BRIEFING.md](BRIEFING.md) — leia antes
de escrever qualquer linha. Ele contém as decisões já tomadas, as regras
de domínio que não podem ser inventadas, e o que este sistema
deliberadamente não é.

## Pilha decidida

React + TypeScript + Vite no cliente; Postgres e Edge Functions no
Supabase. A escolha está justificada no briefing — é a pilha que a equipe
já mantém em produção.
