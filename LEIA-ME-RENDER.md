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

## Limites
O multiplayer é chat + jogadores online; monstros e combate rodam no navegador de cada um.
No plano gratuito a Render dorme após ~15 min sem acesso (primeiro acesso: 30–60 s).
