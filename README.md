# Sessão — chamada + tela compartilhada, só pra vocês dois

App em formato PWA (Progressive Web App): ela instala como se fosse um app de
verdade, sem passar pela App Store e sem custo nenhum.

**Importante sobre iOS:** compartilhar tela pelo navegador só funciona em quem
compartilha (você, no PC/Android). Quem só assiste — ela, no iPhone — funciona
numa boa. Se um dia ela precisar compartilhar a tela do iPhone dela, isso não
é possível pelo navegador (limitação da Apple).

---

## Passo 1 — Subir o servidor de sinalização (Render, grátis)

O servidor só existe pra apresentar vocês dois um ao outro; o vídeo/áudio
nunca passa por ele.

1. Crie um repositório no GitHub e suba a pasta `server/` (ou o projeto
   inteiro).
2. Entre em [render.com](https://render.com) → **New +** → **Web Service**.
3. Conecte o repositório.
4. Configure:
   - **Root Directory:** `server`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** Free
5. Deploy. Ao terminar, copie a URL que o Render te dá, algo como
   `https://watchtogether-signaling.onrender.com`.

⚠️ No plano free o servidor "dorme" depois de 15 min sem uso e demora uns
30-50s pra acordar na próxima chamada. Pra 2 pessoas isso é só esperar um
pouco na primeira vez — sem custo, sem problema real.

## Passo 2 — Configurar o frontend

Abra `frontend/config.js` e troque a URL pela do Render, **trocando `https://`
por `wss://`**:

```js
SIGNALING_URL: "wss://watchtogether-signaling.onrender.com",
```

## Passo 3 — (Recomendado) TURN grátis do metered.ca

Sem isso, a chamada pode falhar quando um de vocês estiver em rede 4G/5G
(CGNAT é comum no Brasil).

1. Crie conta grátis em [metered.ca](https://www.metered.ca/tools/openrelay/)
   (tem 50GB/mês grátis — muito pra uso a dois).
2. Pegue as credenciais TURN geradas.
3. Em `frontend/config.js`, substitua `username` e `credential` pelas suas
   credenciais. O bloco TURN já está habilitado.

## Passo 4 — Subir o frontend (Vercel ou Netlify, grátis)

1. Suba a pasta `frontend/` pro mesmo repositório (ou outro).
2. Em [vercel.com](https://vercel.com) → **Add New** → **Project** → aponte
   pro repositório, com **Root Directory** = `frontend`. Sem build command,
   é site estático.
3. Deploy. Você recebe uma URL tipo `https://sua-sessao.vercel.app`.

## Passo 5 — Ela instala no iPhone

1. Ela abre o link no **Safari** (tem que ser Safari, não funciona por outro
   navegador no iOS).
2. Toca no ícone de compartilhar (quadrado com seta) → **"Adicionar à Tela
   de Início"**.
3. Pronto — ícone próprio, abre em tela cheia, sem parecer navegador.

## Como usar

1. Cada pessoa abre o app e toca em **conectar**.
2. A sessão usa a sala fixa `vinicius-e-dri`; não é necessário digitar código
   ou nome.
3. Quem entrar primeiro fica na tela de espera; quando a segunda pessoa entra,
   a chamada liga sozinha.
4. O botão de compartilhar tela funciona para quem estiver no PC/Android.

Para trocar a sala, altere `fixedRoomId` em `frontend/app.js` e publique o
frontend novamente.

---

## Estrutura do projeto

```
watchtogether/
├── server/           servidor de sinalização (Node.js + WebSocket)
│   ├── server.js
│   └── package.json
└── frontend/          PWA (HTML/CSS/JS puro, sem build)
    ├── index.html
    ├── style.css
    ├── app.js
    ├── config.js       ← edite aqui as URLs/TURN
    ├── manifest.json
    ├── sw.js
    └── icons/
```

Nenhuma etapa exige cartão de crédito. Se algum dia vocês crescerem além do
uso a dois, o mesmo código escala trocando só o plano do Render/metered.ca.
