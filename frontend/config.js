// Edite estes valores depois de hospedar o servidor de sinalização e (opcionalmente)
// criar uma conta grátis no metered.ca para o TURN. Veja o README para o passo a passo.

window.APP_CONFIG = {
  // URL do servidor de sinalização no Render (troque pela sua, começando com wss://)
  SIGNALING_URL: "wss://watchtogether-server-b9zg.onrender.com",

  // Servidores STUN/TURN. O STUN do Google é grátis e sem cadastro.
  // Adicione o TURN do metered.ca (grátis até 50GB/mês) para funcionar mesmo
  // em redes com CGNAT/4G, que é comum no Brasil.
  ICE_SERVERS: [
    {
      urls: "stun:stun.relay.metered.ca:80",
    },
    {
      urls: "turn:global.relay.metered.ca:80",
      username: "06f45cbb81ad6888769bcc8e",
      credential: "uQnnqYW4dun5Rujl",
    },
    {
      urls: "turn:global.relay.metered.ca:80?transport=tcp",
      username: "06f45cbb81ad6888769bcc8e",
      credential: "uQnnqYW4dun5Rujl",
    },
    {
      urls: "turn:global.relay.metered.ca:443",
      username: "06f45cbb81ad6888769bcc8e",
      credential: "uQnnqYW4dun5Rujl",
    },
    {
      urls: "turns:global.relay.metered.ca:443?transport=tcp",
      username: "06f45cbb81ad6888769bcc8e",
      credential: "uQnnqYW4dun5Rujl",
    },
  ],
};
