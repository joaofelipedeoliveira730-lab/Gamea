# Relatório de entrega — NEON PATH: PRESTIGE 12.0.4

## Resultado

A versão recebida foi reciclada em uma edição nova, mantendo a conexão PostgreSQL e a implantação web. O visual foi reconstruído em torno de uma identidade cinematográfica neon, com menus, seleção, lobby, HUD, carregamento e tela final coerentes entre si.

## Correções críticas

- Corrigido o estado do motor que encerrava o loop logo depois de uma inicialização bem-sucedida.
- Removido o endpoint capaz de aceitar XP arbitrário do navegador.
- Corrigido o fluxo de convidado que podia reutilizar um apelido já cadastrado.
- Alinhadas as dimensões visuais e autoritativas dos circuitos.
- Removido o bloqueio obrigatório de orientação; retrato funciona e paisagem é apenas recomendada.
- Corrigidos cache antigo, configuração de URL do backend, IDs obsoletos e relatório de data da Central CEO.
- Adicionadas travas para personagem e circuito exclusivos no Socket.IO, não somente na interface.
- Adicionados limite de requisições, segredo obrigatório em produção e expiração segura de sessão.
- Corrigido o boot no Render com PostgreSQL antigo: migrações agora garantem todas as colunas antes de criar índices, eliminando o erro `42703` sem apagar dados.
- Tornado `CLIENT_ORIGIN` opcional no mesmo serviço e normalizado para aceitar com segurança URLs com ou sem barra final.
- Adicionada compatibilidade automática com colunas `NOT NULL` desconhecidas de lojas antigas, corrigindo o PostgreSQL `23502` durante a carga do catálogo.
- Isoladas a loja e o inventário em `neon_shop_items`/`neon_player_items`, eliminando regras `CHECK` (`23514`) herdadas de outros projetos sem remover as tabelas antigas.
- Corrigida a largada que apagava `userId`, estado de IA e cosméticos; isso podia impedir a persistência de XP/moedas/vitórias e descaracterizar rivais.
- Adicionada janela de reconexão de 12 segundos, com retomada da corrida e restauração do estado no cliente.
- Corrigida a premiação para que falha ao adquirir conexão PostgreSQL não interrompa `finishRace`, e para que falha pós-`COMMIT` ao atualizar o perfil não seja tratada como prêmio perdido.
- Adicionada nova tentativa apenas para falhas transitórias do PostgreSQL durante o boot.
- Bloqueado o acesso HTTP aos arquivos internos do backend e convertidos os caminhos do PWA para relativos, permitindo frontend em subdiretório do GitHub Pages.

## Conteúdo e experiência

- Cinemática de carregamento original em MP4 H.264 e pôster WebP.
- Trilha sintetizada original `Velocity Protocol` em MP3.
- Arte inédita para o menu, Porto Fantasma e emblema de Prestígio.
- Nove circuitos, oito pilotos, drift carregável, turbo, item, bots e matchmaking.
- Loja, inventário e cosméticos 3D para coroa, aura, rastro, chassi e asas.
- Caminho de cinco Prestígios por XP total: Faísca, Vanguarda, Fantasma, Lendário e Imortal.
- Prestígio 5 entrega o `Protocolo Imortal` e abre um circuito secreto protegido no backend.
- Ranking mundial, missão diária e recompensas individuais persistentes.

## Banco de dados

O `server.js` mantém `DATABASE_URL` e executa apenas `CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, índices e atualizações compatíveis. Cada etapa possui diagnóstico próprio e os índices são criados somente depois das colunas das quais dependem. Foram acrescentados XP vitalício, missão diária, detalhes de recompensa, duração/modo da corrida, função do usuário, última atividade e descrição de itens. O `schema.sql` espelha uma instalação nova.

## Desempenho

- Shell inicial abaixo de 450 KiB.
- Pacote Essencial em torno de 2,01 MiB.
- MP4 de 8,5 segundos em torno de 1,1 MiB.
- MP3 de 29,1 segundos abaixo de 500 KiB.
- Perfis Baixo, Médio, Alto e Auto, com queda automática de resolução abaixo de 29 FPS.
- Texturas e cenas HD permanecem opcionais e são armazenadas com até três downloads simultâneos.
- WebGL possui descarte de recursos, fallback procedural, recuperação de contexto e pista de emergência.

## Validação

Passaram 540 simulações de corrida, 1.200 sequências de progressão, 80.000 recompensas adversariais, 10.000 payloads hostis, 165 contratos DOM, sintaxe de quatro scripts, formatos/duração de mídia, orçamento de download, PWA/cache e regras de banco/segurança. Os comandos estão em `package.json` e o resumo em `QA-12.0.txt`.
