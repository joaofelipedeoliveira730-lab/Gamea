# NEON PATH: PRESTIGE 12.0.4

Jogo de corrida arcade 3D multiplayer, feito para rodar inteiramente no navegador em computador e celular. O projeto mantém a estrutura plana da versão recebida e usa Node.js, Express, Socket.IO, Three.js e PostgreSQL.

## Rodar localmente

Requer Node.js 20 ou mais recente e um PostgreSQL acessível.

```bash
npm install
npm test
npm start
```

Abra `http://localhost:3000`. O servidor aplica migrações aditivas e idempotentes durante a inicialização; não há `DROP TABLE` nem `TRUNCATE`.

## Variáveis de ambiente

```env
DATABASE_URL=postgresql://usuario:senha@host:5432/banco
JWT_SECRET=gere-um-segredo-com-pelo-menos-32-caracteres
CEO_ROOM_KEY=gere-uma-chave-ceo-com-pelo-menos-12-caracteres
CLIENT_ORIGIN=https://seu-jogo.onrender.com
PORT=3000
NODE_ENV=production
```

`CLIENT_ORIGIN` é opcional quando frontend e servidor estão no mesmo serviço. Se quiser defini-lo no Render, use a URL pública exata do serviço, sem caminho; uma barra final também é normalizada. Para frontend separado, informe a origem dele (por exemplo, `https://usuario.github.io`) e separe múltiplas origens por vírgula. Quando a variável não existe ou está vazia, o servidor usa `*` sem interromper o boot. Se frontend e backend usam o mesmo domínio, `config.js` deve permanecer vazio.

Em produção, `JWT_SECRET` precisa ter pelo menos 32 caracteres e `CEO_ROOM_KEY`, pelo menos 12. O servidor gera uma mensagem direta se uma dessas configurações estiver ausente ou inválida.
Para PostgreSQL local sem TLS, acrescente `PGSSLMODE=disable`. Em hospedagem, a conexão segura é usada automaticamente.

## Hotfix 12.0.4 para Render

O boot migra tabelas antigas em etapas: primeiro cria ou acrescenta cada coluna e só depois cria os índices, corrigindo o PostgreSQL `42703` (`undefined_column`). Para eliminar definitivamente conflitos `23502` e `23514` de bancos reutilizados, a loja e o inventário agora usam tabelas exclusivas `neon_shop_items` e `neon_player_items`. As tabelas antigas permanecem intactas; compras compatíveis são importadas por código quando possível, mas uma incompatibilidade nelas nunca mais derruba o servidor. Cadastro e convidado também recebem proteção para campos antigos como `username` e `password`. Nenhuma conta ou progresso é apagado.


## Correções 12.0.4

- corrida preserva `userId`, IA dos rivais e cosméticos ao zerar a física na largada; XP, moedas, vitórias e histórico voltam a persistir corretamente;
- reconexão de até 12 segundos durante uma corrida preserva a vaga e restaura a sessão automaticamente;
- salas privadas e CEO completam o grid com rivais quando necessário, sem expor no snapshot se o participante é controlado pelo servidor;
- `health` retorna erro quando o PostgreSQL configurado está indisponível e produção não inicia sem `DATABASE_URL`;
- arquivos internos (`server.js`, `schema.sql`, testes, YAML e relatórios) deixam de ser servidos publicamente;
- PWA e recursos usam caminhos relativos, funcionando em subdiretórios do GitHub Pages;
- chamadas GET da API têm timeout e uma tentativa curta de recuperação para 502/503/504;
- o boot repete somente falhas transitórias de conexão do PostgreSQL e falhas ao atualizar o perfil depois de um `COMMIT` não fazem o jogo dizer que o prêmio foi perdido;
- uma indisponibilidade ao abrir a conexão da premiação não derruba a finalização da corrida.

**Render em 2026:** bancos PostgreSQL gratuitos têm 1 GB e expiram após 30 dias. Para progresso permanente em produção, use um banco pago ou faça a migração antes da expiração.

## O que existe nesta versão

- nove circuitos 3D, incluindo `PROTOCOLO IMORTAL`, liberado apenas no Prestígio 5;
- matchmaking global, corrida solo com grid completo e salas privadas com senha;
- servidor autoritativo para movimento, checkpoint, volta, posição e recompensa;
- 100 níveis, cinco Prestígios por XP total e recompensas exclusivas em cada marco;
- loja transacional, inventário equipável e cosméticos visíveis durante a corrida;
- ranking mundial por Pontos de Honra;
- missão diária, moedas, XP, PH, vitórias e histórico persistidos no PostgreSQL;
- cinemática H.264 de carregamento e trilha original MP3;
- pacote Essencial de aproximadamente 2 MiB e pacote HD opcional;
- qualidade automática com redução de resolução abaixo de 29 FPS;
- controles de teclado e toque, suporte a retrato/paisagem, safe areas e PWA;
- recuperação de WebGL, watchdog de largada e central de relatórios de erro.

## Controles

- Computador: `W`/seta para cima acelera, `S`/seta para baixo freia, `A`/`D` ou setas viram, `X` faz drift e `Shift`/`Espaço` usa turbo.
- Celular: direção, drift, freio, acelerador, turbo e item aparecem na tela. Paisagem é recomendada, mas retrato permanece jogável.

## Segurança da economia

O navegador envia apenas intenção de controle. XP, moedas, PH, bônus diário, Prestígio e resultados são calculados pelo servidor. Compras usam transação e trava de saldo; o endpoint antigo que aceitava XP do cliente responde `server_awards_only`.

## Implantação

O `render.yaml` contém o serviço web. No Render, informe `DATABASE_URL` e escolha uma `CEO_ROOM_KEY` com pelo menos 12 caracteres; `JWT_SECRET` é gerado pelo Blueprint. Quando backend e PostgreSQL estiverem no Render e na mesma região, prefira a **Internal Database URL** como `DATABASE_URL`. `CLIENT_ORIGIN` é opcional no mesmo serviço e necessário quando o frontend está hospedado separadamente. Use:

- Build: `npm install`
- Start: `npm start`


### GitHub Pages no frontend + Render no backend

1. Envie os arquivos do projeto para a raiz do repositório e publique o GitHub Pages.
2. Depois que o Web Service do Render existir, edite `config.js` e defina `window.NEON_API_BASE` com a URL HTTPS do backend Render. Não coloque barra no final.
3. No Render, defina `CLIENT_ORIGIN` somente com a origem do GitHub Pages (por exemplo, `https://usuario.github.io`, sem `/nome-do-repositorio`).
4. Em `DATABASE_URL`, use de preferência a URL **interna** do Render Postgres quando banco e backend estiverem na mesma conta/região.
5. Após o deploy, abra `/health`. O esperado em produção é `ok: true` e `database: "ok"`.

Se depois você hospedar frontend e backend juntos no mesmo Web Service do Render, deixe `config.js` vazio e o navegador usa o mesmo domínio automaticamente.
- Health check: `/health`

O Three.js está fixado na versão `0.178.0` pelo import map. Para uma instalação totalmente isolada de CDN, substitua o endereço do import map por uma cópia local da mesma versão.

## Testes

`npm test` executa três suítes: motor/progressão, mídia/responsividade/PWA e segurança/salas/banco. Consulte `QA-12.0.txt` e `RELATORIO-12.0-PRESTIGE.md`.
