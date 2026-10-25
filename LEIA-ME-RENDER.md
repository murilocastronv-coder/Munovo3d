# MU Online na Render (jogo + multiplayer no mesmo endereço)

## Publicar
1. Copie estes arquivos para a raiz do seu repositório (substituindo a pasta `web/`) e envie ao GitHub.
   Novos na raiz: `multiplayer-server.js`, `package.json`, `render.yaml`.
2. Na Render: **New → Blueprint** (lê o `render.yaml`) ou **New → Web Service** com
   Build `npm install` e Start `npm start`.
3. Abra `https://SEU-SERVICO.onrender.com/`. O multiplayer conecta sozinho.

## No jogo
- Pílula **● N online** no canto superior esquerdo: toque para abrir chat, lista de jogadores e trocar o nome.
  Fechada, só mostra um aviso pequeno quando chega mensagem.
- Celular: botão **Atalhos ▸** (recolhido por padrão) abre poções Q/W/E, pegar item, C, I, M, mapa, grupo, guild, chat e Esc.

## shell_login.data (219 MB)
Fica no Git LFS. Se chegar à Render como ponteiro (~130 bytes), o servidor redireciona para
`SHELL_DATA_URL` (padrão: cópia do autor original no GitHub Pages). Defina a variável para usar a sua.

## Multiplayer no mundo (novo)
Todos entram na mesma sala "Lorencia". Seu cliente lê seus movimentos, manda para o servidor, e os outros
jogadores aparecem dentro do jogo (até 16 casas de distância) e andam em tempo real.
- Um jogador só aparece para os outros depois de dar o **primeiro movimento** (clicar para andar).
- Funciona enquanto todos estão no mesmo mapa (Lorencia). Ao trocar de mapa, a sincronização pausa 2 s.
- **Diagnóstico no celular:** toque na pílula "● N online"; no topo do painel aparece uma caixinha com o estado
  (ws ok/off, mundo sim/não, posição, remotos, visíveis, injetados e os códigos de pacote mais frequentes).
  O módulo aprende sozinho o formato do pacote do seu herói e copia a sua aparência para os outros jogadores.
- Console do navegador (F12) com `?mpdebug=1` na URL mostra o que está sendo enviado/injetado.
- Se os jogadores não aparecerem ou o jogo reclamar: tente `?mpcs=13` (outro tamanho de CharSet) ou
  `?mpworld=0` (desliga só a parte visual; chat e lista continuam).

## Anti-lag
Ping a cada 15 s (mantém o socket vivo e mostra ms na pílula), reconexão em 1 s (e na hora ao voltar pra aba
ou quando a internet volta), Nagle desligado no servidor e o último destino de movimento nunca é descartado.
No plano gratuito da Render o serviço dorme após ~15 min: use um monitor (ex.: UptimeRobot) em `/health`
a cada 5 min para manter acordado.

## Limites
Monstros e combate rodam no navegador de cada um (não são sincronizados). Os outros jogadores aparecem com
a aparência padrão e o nome escolhido.
