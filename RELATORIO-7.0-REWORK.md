# NEON PATH RACING 7.0 — REWORK

## Objetivo
Reestruturado o projeto enviado para uma experiência de corrida em navegador com visual moderno, câmera traseira, pistas com identidade própria, carregamento separado e qualidade ajustável.

## Principais mudanças
- Corrida obrigatoriamente em paisagem no celular; computador usa tela cheia normalmente.
- Login/cadastro ocupam a tela inteira.
- E-mail continua opcional no cadastro.
- Código de sala limitado a 15 caracteres no cliente e no servidor.
- Sala solo pode ser iniciada para teste sem precisar de outro jogador.
- Sala CEO continua protegida por chave no servidor.
- Jogadores comuns não podem iniciar uma sala CEO.
- Modelo de corrida autoritativo no servidor: progresso de pista, 3 voltas, posições e chegada.
- Removido o antigo movimento baseado em giros instantâneos de 90 graus.
- Direção contínua com A/D, setas e controles touch.
- Turbo e item/sabotagem com limites no servidor.
- Tela de carregamento separada antes da corrida.
- Cenário construído sob demanda, em vez de baixar todo o conteúdo de uma vez.
- 8 mapas: Neon City, Pirate Bay, Desert Run, Mountain Peak, Space Station, Jungle Falls, Volcano Rush e Ice World.
- 8 pilotos com identidade visual própria e estatísticas.
- Pista oval com faixa, zebras, linha de largada/chegada e cenários temáticos.
- Câmera traseira acompanhando o piloto.
- Mini mapa, velocidade, volta, energia/turbo e ranking em tempo real.
- Tela final com pódio e recompensas.
- Configuração de qualidade: baixa, média, alta e automática.
- Otimizações de pixel ratio, antialiasing, sombras, partículas e quantidade de objetos.
- Recursos existentes permanecem no pacote para compatibilidade, mas não são carregados todos na abertura.
- Tamanho dos arquivos do projeto continua abaixo do limite solicitado.

## QA executado
- `node --check server.js` — OK
- `node --check app.js` — OK
- `node test.js` — OK
- Verificado limite de 15 caracteres para código no frontend e backend.
- Verificado e-mail opcional no cadastro.
- Verificado bloqueio de início de sala CEO sem autorização.
- Verificado evento de chegada.
- Verificado múltiplos mapas.
- Verificado fluxo de loading separado.
- Verificado perfis de qualidade.

## Observação de tamanho
O diretório final ficou em aproximadamente 16 MB, portanto dentro da meta de 25–50 MB. Isso não significa que o navegador precise baixar os 16 MB antes de mostrar a interface: a corrida usa construção procedural e carregamento sob demanda.

## CEO
A chave de sala CEO existente no projeto continua sendo `Velho202026`, mas a autorização é validada no servidor. A senha da conta deve continuar sendo definida pelo fluxo normal de cadastro/Render, não embutida no código.

## Próximo passo recomendado
Subir o ZIP no GitHub/Render e testar no celular em modo paisagem. O teste de rede real (login PostgreSQL, Socket.IO e Render) depende do ambiente implantado e não pode ser simulado integralmente neste ambiente sem as dependências/credenciais do servidor.
