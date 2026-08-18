# NEON PATH 9.0 — RACING UPGRADE

## Base
Esta versão usa o projeto NEON PATH 8.5 como base. Nenhum arquivo dentro de `resources/` foi alterado.

## Melhorias
- Pista reconstruída como ribbon 3D com largura real, UVs, banking leve, bordas e guard rail.
- Marcações de faixa e grid de largada reposicionados para a geometria da pista.
- Cenários de cidade, pirata, deserto, montanha, selva, vulcão, espaço e gelo receberam composição 3D mais consistente.
- Kart reconstruído com carroceria, cockpit, piloto, capacete, visor, spoiler, rodas, cubos, faróis e escape.
- Câmera traseira suavizada e orientada para a direção da pista.
- Interpolação dos karts entre snapshots para reduzir o efeito de teleporte entre atualizações de rede.
- Inclinação visual do kart baseada na faixa/steering.
- Retrato selecionado pelo jogador é enviado ao servidor e aparece no HUD/race state.
- IA dos bots ganhou linha de corrida, variação controlada de faixa e rubber-banding limitado.
- Recuperação automática de contexto WebGL.
- Controles mobile/PC e carregamento de recursos existentes foram preservados.

## QA
- `node --check app.js`
- `node --check server.js`
- `npm test`
- 300 simulações de corrida do teste automatizado: 100 SOLO, 100 SALA_PRIVADA e 100 CEO, distribuídas nos 8 mapas.

## Recursos
`resources/` não foi modificado nesta versão.
