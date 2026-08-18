# TESTE DE QUALIDADE E ANTI-CHEAT — NEON PATH

Resultado automático: **17/17 verificações passaram**.

## O que foi endurecido
- Servidor autoritativo: o navegador não decide posição final, colisão, kill, vitória ou PH.
- Rate limit de inputs e chat.
- Sequência monotônica dos inputs para reduzir replay/reenvio.
- Pacotes WebSocket grandes/malformados são rejeitados.
- Energia, turbo, sopro e cooldown são calculados no servidor.
- Nicknames são sanitizados.
- Salas e sessões têm limpeza/limites.
- Ranking é atualizado no PostgreSQL pelo servidor.

## Resultado das verificações
- [x] Arquivos principais
- [x] HTML referencia CSS/JS
- [x] Servidor usa WebSocket
- [x] Servidor autoritativo
- [x] Limite de input
- [x] Proteção de sequência
- [x] Limite de chat
- [x] Pacote máximo
- [x] Sanitização de nickname
- [x] Limite de jogadores
- [x] Ranking no banco
- [x] Health endpoint
- [x] SQL sem comandos destrutivos
- [x] Sem segredo no projeto
- [x] Sintaxe Node server.js
- [x] Sintaxe JS app.js
- [x] package.json válido

## Estratégia contra má-fé
1. Nunca confiar em valores enviados pelo cliente.
2. Simular movimento/colisão no servidor.
3. Limitar frequência e tamanho das mensagens.
4. Registrar eventos relevantes para futura auditoria.
5. Em produção, adicionar tabela de partidas/eventos, identificação de desconexões anormais e revisão automática de partidas suspeitas.
