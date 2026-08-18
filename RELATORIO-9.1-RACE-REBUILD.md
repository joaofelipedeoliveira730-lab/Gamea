# NEON PATH RACING 9.1 — REBUILD DO MOTOR DE CORRIDA

## O que foi corrigido
- Pista reconstruída como malha 3D procedural de asfalto. Removida a textura fotográfica usada como asfalto, que causava a aparência de faixa/lâmina branca e distorções.
- Adicionadas faixas tracejadas, zebras, guard-rails, grade de largada, caixas de item flutuantes e elementos de cenário por tema.
- Karts suavizados com geometrias mais arredondadas e acabamento de iluminação/emissão.
- HUD de corrida mantém retratos dos pilotos, posição, volta, minimapa, velocidade e turbo.
- Controles de celular: esquerda, direita, DRIFT, TURBO e ITEM. Os controles usam Pointer Events e seguram corretamente o comando.
- PC: A/D ou setas para direção, SHIFT/ESPAÇO para turbo e X para drift.
- Contagem regressiva sincronizada 3 → 2 → 1 → GO no servidor.
- Rocket Start preparado: turbo durante a janela da largada gera impulso inicial.
- Drift server-authoritative com carga e níveis de boost.
- Checkpoints lógicos de volta e proteção contra avanço de volta sem passar pela sequência.
- Saída da pista reduz a velocidade; lane clamp impede teleporte/exploit.
- Recuperação de WebGL preservada.
- Carregamento >3 s continua exibindo carregamento e indicação de otimização.
- Tela paisagem e tela cheia são solicitadas no início da corrida, em vez de forçar tela cheia no menu.
- Loja continua mostrando “INDISPONÍVEL NO MOMENTO”.

## Recursos
**A pasta `resources/` NÃO foi removida nem substituída nesta revisão.** Os 75 arquivos existentes foram preservados. O trabalho foi concentrado no motor, HUD, controles, física lógica e composição procedural do cenário.

Tamanho dos recursos existentes: aproximadamente 14,71 MiB. Não foi criado enchimento artificial para transformar o projeto em 15 GB, porque isso só aumentaria download/memória e pioraria o desempenho. A estratégia usada é colocar qualidade onde ela realmente aparece: geometria, iluminação, LOD lógico, cache e carregamento sob demanda.

## QA executado
- `npm test`: **OK**
- 300 simulações completas de corrida: **OK**
- 100 Solo + 100 Sala Privada + 100 CEO, em 8 mapas: **OK**
- Testes de clamp, NaN/Infinity e conclusão de pilotos: **OK**
- Proteção de senha/owner/input malicioso: **OK**
- Teste estático de controles mobile, fullscreen/landscape, WebGL recovery, portraits e HD scenes: **OK**

## Observação sobre teste real no navegador
A validação automática do motor e dos arquivos passou. Não foi possível executar um navegador gráfico real neste ambiente porque as dependências de runtime do servidor não estavam instaladas localmente (`dotenv` não estava disponível), então não vou fingir que fiz uma partida visual real aqui. O projeto foi deixado com o `package.json` correto para instalação/deploy.
