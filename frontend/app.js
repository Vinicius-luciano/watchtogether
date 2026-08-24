(() => {
  "use strict";

  const cfg = window.APP_CONFIG;

  // ---------- elementos ----------
  const screenEntry = document.getElementById("screen-entry");
  const screenWaiting = document.getElementById("screen-waiting");
  const screenCall = document.getElementById("screen-call");

  const roomInput = document.getElementById("room-code");
  const nameInput = document.getElementById("display-name");
  const btnEnter = document.getElementById("btn-enter");
  const entryError = document.getElementById("entry-error");

  const waitingRoomName = document.getElementById("waiting-room-name");
  const btnCancelWait = document.getElementById("btn-cancel-wait");

  const callRoomName = document.getElementById("call-room-name");
  const callTimer = document.getElementById("call-timer");
  const remoteVideo = document.getElementById("remote-video");
  const localVideo = document.getElementById("local-video");
  const remoteEmpty = document.getElementById("remote-empty");
  const callToast = document.getElementById("call-toast");

  const btnMic = document.getElementById("btn-mic");
  const btnCam = document.getElementById("btn-cam");
  const btnShare = document.getElementById("btn-share");
  const shareLabel = document.getElementById("share-label");
  const btnLeave = document.getElementById("btn-leave");

  // ---------- estado ----------
  let ws = null;
  let pc = null;
  let localStream = null; // pode ficar null se não tiver câmera nem mic
  let remoteStream = null;
  let screenStream = null;
  let audioSender = null;
  let videoSender = null;
  let hasAudio = false;
  let hasVideo = false;
  let isInitiator = false;
  let roomId = "";
  let micOn = true;
  let camOn = true;
  let sharing = false;
  let timerHandle = null;
  let secondsElapsed = 0;

  function showScreen(el) {
    [screenEntry, screenWaiting, screenCall].forEach((s) => (s.hidden = s !== el));
  }

  function toast(msg, ms = 3000) {
    callToast.textContent = msg;
    callToast.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => (callToast.hidden = true), ms);
  }

  function slugify(str) {
    return str
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");
  }

  // ---------- captura de câmera/mic, com fallback gradual ----------
  // tenta câmera+mic -> só mic -> nada (só tela compartilhada mais tarde)
  // cada tentativa tem um limite de tempo: em alguns sistemas sem câmera,
  // getUserMedia trava pra sempre em vez de dar erro rápido.
  function withTimeout(promise, ms) {
    return Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)),
    ]);
  }

  async function acquireLocalMedia() {
    console.log("[debug] tentando câmera+mic…");
    try {
      const stream = await withTimeout(
        navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: true }),
        4000
      );
      console.log("[debug] câmera+mic OK");
      return { stream, hasAudio: true, hasVideo: true };
    } catch (err) {
      console.log("[debug] câmera+mic falhou:", err && err.name, err && err.message);
    }

    console.log("[debug] tentando só mic…");
    try {
      const stream = await withTimeout(
        navigator.mediaDevices.getUserMedia({ audio: true }),
        4000
      );
      console.log("[debug] só mic OK");
      return { stream, hasAudio: true, hasVideo: false };
    } catch (err) {
      console.log("[debug] só mic falhou:", err && err.name, err && err.message);
    }

    console.log("[debug] seguindo sem mídia nenhuma");
    return { stream: null, hasAudio: false, hasVideo: false };
  }

  function applyLocalMediaUI() {
    if (!hasVideo) {
      btnCam.disabled = true;
      btnCam.title = "nenhuma câmera disponível neste dispositivo";
      localVideo.hidden = true; // some até começar a compartilhar tela
    }
    if (!hasAudio) {
      btnMic.disabled = true;
      btnMic.title = "nenhum microfone disponível neste dispositivo";
    }
    if (!hasVideo && !hasAudio) {
      toast("entrando sem câmera/microfone — só a tela compartilhada e o chat de voz de quem tiver", 4000);
    } else if (!hasVideo) {
      toast("sem câmera detectada — entrando só com áudio", 3500);
    }
  }

  // ---------- fluxo de entrada ----------
  btnEnter.addEventListener("click", async () => {
    const raw = roomInput.value;
    const room = slugify(raw);
    if (!room) {
      entryError.textContent = "digita um código pra sala primeiro.";
      entryError.hidden = false;
      return;
    }
    entryError.hidden = true;
    roomId = room;
    btnEnter.disabled = true;
    btnEnter.querySelector("span").textContent = "verificando câmera/mic…";

    const result = await acquireLocalMedia();
    console.log("[debug] resultado final:", result);
    localStream = result.stream;
    hasAudio = result.hasAudio;
    hasVideo = result.hasVideo;

    if (localStream && hasVideo) {
      localVideo.srcObject = localStream;
      localVideo.hidden = false;
    }

    waitingRoomName.textContent = roomId;
    console.log("[debug] trocando pra tela de espera");
    showScreen(screenWaiting);
    applyLocalMediaUI();
    console.log("[debug] conectando no servidor de sinalização:", cfg.SIGNALING_URL);
    connectSignaling();
  });

  btnCancelWait.addEventListener("click", () => {
    cleanupAndReset();
    showScreen(screenEntry);
    btnEnter.disabled = false;
    btnEnter.querySelector("span").textContent = "entrar na sessão";
  });

  // ---------- sinalização (WebSocket) ----------
  function connectSignaling() {
    ws = new WebSocket(cfg.SIGNALING_URL);

    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({ type: "join", room: roomId }));
    });

    ws.addEventListener("message", async (event) => {
      const msg = JSON.parse(event.data);

      switch (msg.type) {
        case "joined":
          isInitiator = msg.isInitiator;
          break;

        case "room-full":
          entryError.textContent = "essa sala já tem duas pessoas. Combinem outro código.";
          entryError.hidden = false;
          cleanupAndReset();
          showScreen(screenEntry);
          btnEnter.disabled = false;
          btnEnter.querySelector("span").textContent = "entrar na sessão";
          break;

        case "peer-ready":
          startCall();
          if (isInitiator) await makeOffer();
          break;

        case "offer":
          await handleOffer(msg.sdp);
          break;

        case "answer":
          await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
          break;

        case "ice-candidate":
          if (pc && msg.candidate) {
            try {
              await pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
            } catch {
              /* candidato tardio, ignora */
            }
          }
          break;

        case "peer-left":
          toast("ela saiu da sessão");
          remoteStream = null;
          remoteVideo.srcObject = null;
          remoteEmpty.classList.remove("hidden");
          break;
      }
    });

    ws.addEventListener("close", () => {
      if (!screenCall.hidden) toast("conexão com o servidor caiu");
    });
  }

  function send(msg) {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }

  // ---------- WebRTC ----------
  // Sempre cria transceivers de áudio e vídeo, MESMO sem câmera/mic locais.
  // Isso garante que dá pra ligar a tela compartilhada depois (via replaceTrack)
  // sem precisar ter tido uma câmera desde o início.
  function createPeerConnection() {
    pc = new RTCPeerConnection({ iceServers: cfg.ICE_SERVERS });

    const audioTransceiver = pc.addTransceiver("audio", { direction: "sendrecv" });
    const videoTransceiver = pc.addTransceiver("video", { direction: "sendrecv" });
    audioSender = audioTransceiver.sender;
    videoSender = videoTransceiver.sender;

    if (localStream) {
      const aTrack = localStream.getAudioTracks()[0];
      const vTrack = localStream.getVideoTracks()[0];
      if (aTrack) audioSender.replaceTrack(aTrack);
      if (vTrack) videoSender.replaceTrack(vTrack);
    }

    pc.addEventListener("icecandidate", (e) => {
      if (e.candidate) send({ type: "ice-candidate", candidate: e.candidate });
    });

    pc.addEventListener("track", (e) => {
      if (!remoteStream) remoteStream = new MediaStream();
      if (!remoteStream.getTracks().some((track) => track.id === e.track.id)) {
        remoteStream.addTrack(e.track);
      }
      remoteVideo.srcObject = remoteStream;
      remoteEmpty.classList.add("hidden");
      remoteVideo.play().catch(() => {});
    });

    pc.addEventListener("connectionstatechange", () => {
      if (pc.connectionState === "connected") toast("conectado ✓", 2000);
      if (["disconnected", "failed"].includes(pc.connectionState)) {
        toast("conexão instável…");
      }
    });
  }

  async function makeOffer() {
    createPeerConnection();
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    send({ type: "offer", sdp: offer });
  }

  async function handleOffer(sdp) {
    createPeerConnection();
    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    send({ type: "answer", sdp: answer });
  }

  function startCall() {
    callRoomName.textContent = roomId;
    showScreen(screenCall);
    startTimer();
  }

  function startTimer() {
    secondsElapsed = 0;
    updateTimerLabel();
    timerHandle = setInterval(() => {
      secondsElapsed++;
      updateTimerLabel();
    }, 1000);
  }

  function updateTimerLabel() {
    const m = String(Math.floor(secondsElapsed / 60)).padStart(2, "0");
    const s = String(secondsElapsed % 60).padStart(2, "0");
    callTimer.textContent = `${m}:${s}`;
  }

  // ---------- controles ----------
  btnMic.addEventListener("click", () => {
    if (!hasAudio || !localStream) return;
    micOn = !micOn;
    localStream.getAudioTracks().forEach((t) => (t.enabled = micOn));
    btnMic.setAttribute("aria-pressed", String(micOn));
  });

  btnCam.addEventListener("click", () => {
    if (!hasVideo || !localStream) return;
    camOn = !camOn;
    localStream.getVideoTracks().forEach((t) => (t.enabled = camOn));
    btnCam.setAttribute("aria-pressed", String(camOn));
  });

  btnShare.addEventListener("click", async () => {
    if (!navigator.mediaDevices.getDisplayMedia) {
      toast("este navegador não permite compartilhar tela (comum no iPhone/iPad)");
      return;
    }

    if (!sharing) {
      try {
        screenStream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: true,
        });
      } catch {
        return; // usuário cancelou o seletor de tela
      }

      const screenTrack = screenStream.getVideoTracks()[0];
      if (videoSender) await videoSender.replaceTrack(screenTrack);

      localVideo.srcObject = screenStream;
      localVideo.hidden = false;

      screenTrack.addEventListener("ended", stopSharing);

      sharing = true;
      btnShare.setAttribute("aria-pressed", "true");
      shareLabel.textContent = "parar compartilhar";
      toast("compartilhando sua tela");
    } else {
      stopSharing();
    }
  });

  async function stopSharing() {
    if (screenStream) screenStream.getTracks().forEach((t) => t.stop());
    screenStream = null;

    const cameraTrack = hasVideo && localStream ? localStream.getVideoTracks()[0] : null;
    if (videoSender) await videoSender.replaceTrack(cameraTrack || null);

    if (cameraTrack) {
      localVideo.srcObject = localStream;
      localVideo.hidden = false;
    } else {
      localVideo.srcObject = null;
      localVideo.hidden = true; // sem câmera - não tem o que mostrar no PIP agora
    }

    sharing = false;
    btnShare.setAttribute("aria-pressed", "false");
    shareLabel.textContent = "compartilhar tela";
  }

  btnLeave.addEventListener("click", () => {
    send({ type: "leave" });
    cleanupAndReset();
    location.reload();
  });

  function cleanupAndReset() {
    clearInterval(timerHandle);
    if (pc) pc.close();
    if (localStream) localStream.getTracks().forEach((t) => t.stop());
    if (screenStream) screenStream.getTracks().forEach((t) => t.stop());
    if (ws) ws.close();
    pc = null;
    ws = null;
  }

  // registra o service worker (deixa o app instalável / abrindo rápido)
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    });
  }
})();
