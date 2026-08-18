# NEON PATH 5.0 — Relatório completo

## Objetivo
Versão focada em multiplayer 3D web leve, progressão persistente e segurança server-side.

## Autenticação
- Cadastro e login com sessão JWT.
- Senhas devem permanecer com hash bcrypt no backend existente.
- Token fica no cliente apenas para autenticar chamadas.
- Perfil persistente ligado ao `user_id`.

## Progressão
- XP persistente no PostgreSQL.
- Níveis de 1 a 100.
- Curva de XP progressiva.
- Vitórias, corridas e PH preparados no perfil.
- Personagem selecionado salvo no banco.
- Tabela `player_characters` preparada para desbloqueios.

## Prestígio
- Ao atingir o nível 100, o jogador pode entrar no próximo ciclo de prestígio.
- O ciclo reinicia o nível e XP, preservando a quantidade de prestígios.
- O design permite adicionar efeitos, títulos e cosméticos exclusivos sem vantagem competitiva.
- A UI possui barra de XP e identidade visual de prestígio.

## Banco de dados
Novas estruturas:
- `player_profiles`
- `player_characters`
- índice de ranking por prestígio/nível/XP

Não armazenar senhas em texto puro nem segredos no GitHub. Use variáveis de ambiente no Render.

## Anti-abuso
A autoridade deve continuar no servidor: movimento, velocidade, colisões, cooldowns, recompensas e XP não devem ser confiados ao navegador. Recompensas de XP devem ser validadas pelo resultado da corrida.

## Otimização
- Low-poly.
- Vertex colors quando possível.
- Shaders para glow.
- Texturas comprimidas e pequenas.
- Billboard para elementos distantes.
- Download progressivo.
- Perfil de qualidade baixo/médio/alto.
- Recursos extras carregados somente quando necessários.

## Meta de tamanho
O pacote foi ampliado para aproximadamente 15 MB com recursos visuais reais, mantendo a meta de download inicial baixo através do carregamento sob demanda.

## Estrutura
Projeto sem necessidade de múltiplas pastas para o usuário: arquivos principais permanecem na raiz; recursos visuais ficam em `resources/` para permitir cache e carregamento seletivo.

## Próxima etapa recomendada
Conectar os eventos reais de final de corrida ao endpoint de XP/recompensa, registrar resultados no banco e ativar o ranking global a partir desses resultados.
