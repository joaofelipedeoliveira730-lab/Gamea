# NEON PATH 9.5 — Recuperação da corrida + remoção da Garagem

## Correções
- Corrigido o fluxo que deixava a tela em `RECUPERANDO A PISTA` quando um detalhe do mundo 3D lançava exceção.
- O mundo 3D agora é construído por uma camada segura: se algum detalhe falhar, uma pista procedural de emergência é criada e a corrida continua.
- O fallback não depende de texturas externas para existir.
- O carregamento de cenário não pode mais impedir a entrada na corrida.
- Mantido o carregamento assíncrono dos cenários HD.
- Removido o botão **GARAGEM** do menu principal, conforme solicitado.
- O espaço do menu foi reorganizado para não deixar uma coluna vazia.
- Nenhum arquivo da pasta `resources/` foi removido.

## Validação
- `node --check app.js`: OK
- `node --check server.js`: OK
- `npm test`: executar no ambiente de implantação para validar banco/WebSocket conforme configuração.
- Teste estrutural: nenhuma referência ativa a `garageBtn`.

## Observação
O objetivo do fallback é evitar que um erro visual derrube a jogabilidade. Quando um detalhe 3D não puder ser criado, a pista continua funcional em modo seguro em vez de prender o jogador na tela de recuperação.
