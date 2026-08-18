# NEON PATH RACING 7.2 — MEGA CORREÇÃO

## Fluxo corrigido
- **JOGAR** abre um seletor de modos em vez de cair diretamente em sala.
- **SOLO** entra direto no carregamento da corrida e usa oponentes de IA server-authoritative sem exibir ao jogador o campo/flag `bot`.
- **SALA PRIVADA** exige nome da sala e senha. O servidor gera código de até 15 caracteres.
- **ENTRAR EM SALA** exige código + senha.
- Sala privada não recebe IA automaticamente.
- Início de sala privada é autorizado pelo dono da sala; CEO continua protegido por chave.
- `room:leave` foi adicionado para sair sem recarregar a página.

## Loja
A loja foi temporariamente desativada na interface e mostra **INDISPONÍVEL NO MOMENTO**.

## Termos e recursos
Depois do login, o jogador precisa aceitar os termos e preparar os recursos. O cliente usa Cache API e baixa somente um conjunto essencial inicial; pistas e detalhes continuam sendo carregados sob demanda.

## Celular
- Layout é orientado para paisagem.
- Botão de tela cheia solicita Fullscreen API.
- Quando disponível, `screen.orientation.lock('landscape')` é solicitado após gesto do usuário.
- O aviso de rotação permanece como fallback quando o navegador não permite bloqueio automático.

## Otimização
- Qualidade Baixa/Média/Alta/Auto.
- Antialiasing e sombras são reduzidos na qualidade baixa.
- Pixel ratio limitado no modo automático.
- Partículas e detalhes do cenário são reduzidos conforme a qualidade.
- Recursos de pista são carregados sob demanda.

## Segurança/anti-má-fé
- Senha de sala não é transmitida de volta ao cliente.
- Senha é armazenada em hash SHA-256 na memória da sala.
- Código de sala é validado no servidor e limitado a 15 caracteres.
- Jogadores comuns não podem iniciar uma sala que não possuem.
- O estado público não contém a propriedade `bot`. A IA permanece apenas como estado interno do servidor.
- Progresso/velocidade dos pilotos continuam autoritativos no servidor.

## QA realizado
- `node --check app.js` — OK
- `node --check server.js` — OK
- `npm test` — OK
- Verificação automática de IDs HTML usados pelo app — 93 referências, 0 IDs ausentes.
- Simulação Solo: 1 humano + 7 IA, 3 voltas — finalizada.
- Simulação Sala Privada: nome + senha + código <= 15 — OK.
- Verificação de vazamento do campo `bot` para o cliente — OK.

## Tamanho
O projeto permanece propositalmente leve (~15 MB no estado atual). Não foi criado lixo artificial para atingir dezenas de GB: em um jogo web isso aumentaria o download, consumo de armazenamento e tempo de carregamento sem melhorar a qualidade. A arquitetura está preparada para um orçamento de recursos na faixa de dezenas de MB, com carregamento sob demanda.
