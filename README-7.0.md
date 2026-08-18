# NEON PATH 7.0 — Mega correção / QA

## Render
- Runtime: Node
- Build: `npm install`
- Start: `npm start`
- Variáveis: `NODE_ENV`, `JWT_SECRET`, `DATABASE_URL`, `CEO_ROOM_KEY`

## Sala CEO de teste
- Código: `Velho202026` (comparação case-insensitive)
- Chave: definida por `CEO_ROOM_KEY`
- Máximo do código: 15 caracteres
- A sala é criada automaticamente na inicialização do servidor.
- CEO pode iniciar sozinho.

## Segurança aplicada
- servidor é autoridade para movimento;
- cliente não envia posição/velocidade válida para o servidor;
- validação de todos os tipos de input;
- limite de mensagens por jogador;
- cooldown de turbo e sabotagem;
- sabotagem só busca alvo à frente e em alcance;
- nickname sanitizado;
- rate limit HTTP;
- senha com bcrypt;
- JWT com expiração;
- XP não pode ser concedido diretamente pelo cliente;
- compras usam transação e bloqueio de linha;
- sala CEO exige chave;
- excesso de mensagens inválidas encerra a conexão.

## QA
`npm test` executa testes estáticos, segurança, interface e 100 partidas simuladas.
