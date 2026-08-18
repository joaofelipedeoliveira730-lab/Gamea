# NEON PATH 8.0 — Mega Correção Real

## Base utilizada
Esta versão foi feita diretamente sobre o projeto NEON PATH 7.2 enviado pelo usuário.

## Recursos — aviso obrigatório
SIM, a pasta `resources/` foi modificada nesta versão.

Importante: nenhum arquivo antigo de `resources/` foi apagado ou substituído.
Foram adicionados dois conjuntos novos:
- `resources/hd_scenes/` — 8 cenários vetoriais leves carregados por pista.
- `resources/portraits/` — 8 retratos leves dos corredores usados no HUD e seleção.

Os recursos antigos foram preservados mesmo quando não são utilizados pelo novo renderer, para não destruir trabalho anterior.

## Renderização
- pista oval refeita com asfalto, ombros, meio-fio e marcações;
- carro com silhueta arredondada, cockpit, spoiler, rodas, cubos, faróis e iluminação;
- câmera traseira mais próxima de um kart racer;
- cenário por mapa com identidade própria;
- partículas adaptativas;
- qualidade baixa/média/alta/auto;
- pixel ratio limitado para evitar desperdício em celulares;
- carregamento do cenário sob demanda.

## Carregamento
O jogo não deve esconder a corrida em uma tela de loading sem necessidade.
A tela de `CARREGANDO...` só aparece quando o recurso de pista realmente demora mais de 3 segundos.
Se carregar antes disso, a corrida segue diretamente.

## Modos
- Solo com 7 adversários internos;
- Sala privada com nome e senha;
- Entrada por código + senha;
- CEO com chave no servidor;
- IA não é identificada como BOT na interface pública.

## Segurança / anti-má-fé
- velocidade e posição continuam autoritativas no servidor;
- limite de frequência de inputs;
- limite de faixa/lane no servidor;
- cliente não escolhe o alvo do sabotagem;
- proprietário controla início da sala;
- senha de sala armazenada como hash;
- comandos desconhecidos não produzem ação válida.

## QA
- sintaxe de `app.js` e `server.js` validada;
- 800 corridas simuladas: 3 modos x 8 mapas com cobertura repetida;
- 100 simulações adicionais de salas privadas;
- casos de payloads maliciosos testados;
- recursos antigos comparados com a versão base: nenhum arquivo antigo removido.

## Tamanho
O pacote não foi artificialmente inflado para 15 GB. Para jogo web isso aumentaria download, memória e tempo de carregamento sem melhorar o renderer. A versão preserva os 14+ MB de recursos originais e adiciona recursos novos leves, ficando otimizada para carregamento sob demanda.
