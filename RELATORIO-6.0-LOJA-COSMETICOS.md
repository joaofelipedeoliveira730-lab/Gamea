# NEON PATH 6.0 — Loja, Inventário e Conta de Teste

## Loja
A loja agora possui cosméticos que alteram a aparência do veículo/personagem sem alterar atributos competitivos:
- Coroas
- Rastros de plasma
- Auras
- Faíscas de motor
- Asas neon
- Efeito de entrada

## Inventário
Cada item comprado fica persistido no PostgreSQL. O jogador pode equipar um item por categoria. O equipamento é salvo no servidor.

## Economia
A compra usa `bruto_coins` no banco e ocorre em transação PostgreSQL. O servidor verifica saldo e propriedade; o cliente não pode simplesmente marcar um item como comprado.

## Segurança
A senha da conta CEO fornecida pelo usuário não foi colocada em arquivo, JavaScript ou SQL. Isso evita vazamento acidental ao publicar no GitHub.

## Design
Os itens usam CSS/SVG/efeitos procedurais para manter o visual bonito sem transformar o download em um pacote enorme.

## Próxima integração
Durante a partida, o snapshot do jogador deve carregar os cosméticos equipados e o renderer aplicar:
- coroa acima do hovercraft;
- rastro atrás do veículo;
- aura;
- partículas;
- efeito de spawn.

Tudo permanece cosmético e não altera velocidade, colisão ou física.
