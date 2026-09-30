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

Projeto em desenho. Nada implementado ainda.

O briefing de arquitetura está em [BRIEFING.md](BRIEFING.md) — leia antes
de escrever qualquer linha. Ele contém as decisões já tomadas, as regras
de domínio que não podem ser inventadas, e o que este sistema
deliberadamente não é.

## Pilha decidida

React + TypeScript + Vite no cliente; Postgres e Edge Functions no
Supabase. A escolha está justificada no briefing — é a pilha que a equipe
já mantém em produção.
