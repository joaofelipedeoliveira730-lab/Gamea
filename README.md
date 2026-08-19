# NEON PATH: PRESTIGE 12.0.1

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

## Hotfix 12.0.1 para Render

O boot agora migra tabelas antigas em etapas: primeiro cria ou acrescenta cada coluna e só depois cria os índices. Isso corrige o PostgreSQL `42703` (`undefined_column`) observado em bancos reutilizados, sem apagar tabelas, contas, ranking, loja ou progresso. Se outra incompatibilidade de esquema aparecer, o log informa a etapa exata no formato `[database migration: tabela.etapa]`.

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

O `render.yaml` contém o serviço web. Configure `DATABASE_URL`, `JWT_SECRET` e `CEO_ROOM_KEY` no painel do Render. `CLIENT_ORIGIN` é opcional no mesmo serviço e recomendado quando o frontend está hospedado separadamente. Use:

- Build: `npm install`
- Start: `npm start`
- Health check: `/health`

O Three.js está fixado na versão `0.178.0` pelo import map. Para uma instalação totalmente isolada de CDN, substitua o endereço do import map por uma cópia local da mesma versão.

## Testes

`npm test` executa três suítes: motor/progressão, mídia/responsividade/PWA e segurança/salas/banco. Consulte `QA-12.0.txt` e `RELATORIO-12.0-PRESTIGE.md`.
