# NEON PATH 9.2 — CORREÇÃO VISUAL DO MOTOR DE CORRIDA

## Problemas atacados nesta revisão
- A pista aparecia como uma faixa/lâmina sem chão e com pouco cenário.
- O mapa ficava escuro/vazio em situações em que o cenário externo não carregava a tempo.
- As caixas de item ficavam grandes demais e no meio da linha de corrida.
- A câmera estava alta demais para uma leitura de kart arcade.
- Os karts pareciam pequenos e pouco presentes na cena.
- O cenário dependia demais de um sprite externo para ter vida.

## O que foi feito
- Criado um **fallback 3D procedural de cenário** dentro do motor: céu, sol, morros, árvores, arbustos, pedras, nuvens, prédios, montanhas e elementos temáticos.
- A pista agora possui uma faixa de terreno/ombro visível sob o asfalto, deixando claro onde termina a pista.
- Mantidos asfalto, faixas de rolamento, zebras, guard-rails e linha de largada.
- Caixas de item reduzidas e posicionadas próximas às laterais da pista, sem formar uma barreira no centro.
- Câmera reposicionada para uma visão traseira baixa, mais próxima de um kart racer arcade.
- Karts receberam escala visual maior e suavização temporal de posição/rotação.
- Iluminação ambiente reforçada para não deixar a pista morta quando o fundo externo estiver atrasado.
- O cenário procedural não depende de uma foto pesada nem substitui a pasta `resources/`.

## Recursos
**Não foram apagados, substituídos ou reduzidos os arquivos existentes da pasta `resources/`.** A pasta foi preservada. Esta revisão concentra as mudanças em `app.js`, `test.js` e `package.json`, justamente para evitar destruir recursos que já estavam no projeto.

## Testes executados
- `node --check app.js`: OK
- `node --check server.js`: OK
- `node test.js`: OK
- 300 simulações de corrida: OK (100 Solo + 100 Sala Privada + 100 CEO, distribuídas pelos 8 mapas)
- Testes de limite de faixa, NaN/Infinity, conclusão de pilotos, senha, dono da sala e payloads maliciosos: OK

## Limitação importante
Não vou dizer que fiz um teste gráfico real de navegador se ele não aconteceu. O ambiente de execução desta revisão não conseguiu iniciar a pilha completa do navegador com as dependências externas do projeto dentro do tempo disponível. Portanto, a validação gráfica real deve ser feita no próprio Render/navegador após o deploy.

## Filosofia de performance
Não foi colocado lixo artificial para transformar o projeto em vários GB. Qualidade de jogo não vem de tamanho vazio: vem de geometria útil, LOD, draw calls controladas, resolução adaptativa, carregamento sob demanda e recursos realmente utilizados.
