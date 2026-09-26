(() => {
  "use strict";

  const cfg = window.APP_CONFIG;

  // ---------- elementos ----------
  const screenEntry = document.getElementById("screen-entry");
  const screenWaiting = document.getElementById("screen-waiting");
  const screenCall = document.getElementById("screen-call");

  const btnEnter = document.getElementById("btn-enter");
  const btnCopyInvite = document.getElementById("btn-copy-invite");
  const entryHint = document.getElementById("entry-hint");
  const entryError = document.getElementById("entry-error");

  const waitingRoomName = document.getElementById("waiting-room-name");
  const btnCancelWait = document.getElementById("btn-cancel-wait");

  const callRoomName = document.getElementById("call-room-name");
  const callTimer = document.getElementById("call-timer");
  const callStatus = document.getElementById("call-status");
  const stage = screenCall.querySelector(".stage");
  const remoteVideo = document.getElementById("remote-video");
  const remoteAudio = document.getElementById("remote-audio");
  const remoteEmpty = document.getElementById("remote-empty");
  const callToast = document.getElementById("call-toast");

  const btnAudio = document.getElementById("btn-audio");
  const btnShare = document.getElementById("btn-share");
  const btnFullscreen = document.getElementById("btn-fullscreen");
  const btnPip = document.getElementById("btn-pip");
  const shareLabel = document.getElementById("share-label");
  const btnLeave = document.getElementById("btn-leave");

  // ---------- estado ----------
  let ws = null;
  let pc = null;
  let remoteStream = null;
  let screenStream = null;
  let shareAudioContext = null;
  let mixedAudioTrack = null;
  let audioSender = null;
  let videoSender = null;
  let isInitiator = false;
  let roomId = "";
  let sharing = false;
  let timerHandle = null;
  let signalingTimeoutHandle = null;
  let controlsHideHandle = null;
  let connectionRecoveryHandle = null;
  let recoveringConnection = false;
  let signalingHeartbeatHandle = null;
  let wakeLockHandle = null;
  let remoteAudioMutedForSharing = false;
  let remoteAudioWasMutedBeforeSharing = false;
  let secondsElapsed = 0;
  const landscapeQuery = window.matchMedia("(orientation: landscape)");
  const controlsVisibleMs = 3000;
  const pendingIceCandidates = [];
  const fixedRoomId = "vinicius-e-dri-v2";
  const clientIdKey = "watchtogether-client-id";
  const clientId = getClientId();

  function getClientId() {
    const storedId = localStorage.getItem(clientIdKey);
    if (storedId) return storedId;
    const newId = crypto.randomUUID();
    localStorage.setItem(clientIdKey, newId);
    return newId;
  }

  function showScreen(el) {
    [screenEntry, screenWaiting, screenCall].forEach(
      (s) => (s.hidden = s !== el),
    );
  }

  function toast(msg, ms = 3000) {
    callToast.textContent = msg;
    callToast.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => (callToast.hidden = true), ms);
  }

  function setConnectionStatus(status) {
    callStatus.textContent = status;
    callStatus.dataset.state = status;
  }

  async function requestWakeLock() {
    if (!("wakeLock" in navigator) || document.visibilityState !== "visible") {
      return;
    }
    try {
      wakeLockHandle = await navigator.wakeLock.request("screen");
    } catch {
      wakeLockHandle = null;
    }
  }

  function releaseWakeLock() {
    if (!wakeLockHandle) return;
    wakeLockHandle.release().catch(() => {});
    wakeLockHandle = null;
  }

  async function unlockRemoteAudio() {
    if (!remoteVideo.srcObject) return;
    remoteVideo.muted = true;
    remoteAudio.srcObject = remoteVideo.srcObject;
    try {
      await remoteAudio.play();
      btnAudio.hidden = true;
    } catch {
      btnAudio.hidden = false;
    }
  }

  // ---------- fluxo de entrada ----------
  async function enterSession() {
    entryError.hidden = true;
    roomId = fixedRoomId;
    btnEnter.disabled = true;
    btnEnter.querySelector("span").textContent = "conectando…";
    entryHint.textContent = "Conectando à sessão…";

    waitingRoomName.textContent = roomId;
    showScreen(screenWaiting);
    connectSignaling();
  }

  btnEnter.addEventListener("click", enterSession);

  btnCopyInvite.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      entryHint.textContent = "convite copiado — é só enviar o link para ela.";
    } catch {
      entryHint.textContent = "copie o link desta página e envie para ela.";
    }
  });

  btnCancelWait.addEventListener("click", () => {
    cleanupAndReset();
    showScreen(screenEntry);
    btnEnter.disabled = false;
    btnEnter.querySelector("span").textContent = "conectar";
    entryHint.textContent = "A sessão começa quando os dois entrarem.";
  });

  // ---------- sinalização (WebSocket) ----------
  function connectSignaling() {
    ws = new WebSocket(cfg.SIGNALING_URL);
    signalingTimeoutHandle = setTimeout(() => {
      if (ws?.readyState === WebSocket.CONNECTING) {
        ws.close();
        resetAfterPeerDisconnect("o servidor demorou para responder");
      }
    }, 60000);

    ws.addEventListener("open", () => {
      setConnectionStatus("conectando");
      clearTimeout(signalingTimeoutHandle);
      signalingTimeoutHandle = null;
      clearInterval(signalingHeartbeatHandle);
      signalingHeartbeatHandle = setInterval(() => {
        send({ type: "heartbeat" });
      }, 10000);
      ws.send(JSON.stringify({ type: "join", room: roomId, clientId }));
    });

    ws.addEventListener("message", async (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }

      try {
        switch (msg.type) {
          case "joined":
            isInitiator = msg.isInitiator;
            break;

          case "room-full":
            entryError.textContent =
              "essa sessão já está com duas pessoas. Tente novamente mais tarde.";
            entryError.hidden = false;
            cleanupAndReset();
            showScreen(screenEntry);
            btnEnter.disabled = false;
            btnEnter.querySelector("span").textContent = "conectar";
            entryHint.textContent = "A sessão começa quando os dois entrarem.";
            break;

          case "peer-ready":
            setConnectionStatus("conectado");
            startCall();
            if (isInitiator) await makeOffer();
            break;

          case "offer":
            await handleOffer(msg.sdp);
            break;

          case "answer":
            await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
            while (pendingIceCandidates.length) {
              await pc.addIceCandidate(pendingIceCandidates.shift());
            }
            break;

          case "ice-candidate":
            if (msg.candidate) {
              try {
                const candidate = new RTCIceCandidate(msg.candidate);
                if (pc?.remoteDescription) {
                  await pc.addIceCandidate(candidate);
                } else {
                  pendingIceCandidates.push(candidate);
                }
              } catch {
                /* candidato tardio, ignora */
              }
            }
            break;

          case "peer-left":
            setConnectionStatus("offline");
            resetAfterPeerDisconnect("ela saiu da sessão");
            break;
        }
      } catch {
        resetAfterPeerDisconnect("não foi possível estabelecer a conexão");
      }
    });

    ws.addEventListener("error", () => {
      setConnectionStatus("instável");
      if (screenCall.hidden) {
        resetAfterPeerDisconnect("não foi possível conectar ao servidor");
      } else {
        toast("conexão com o servidor perdida");
      }
    });

    ws.addEventListener("close", () => {
      setConnectionStatus("offline");
      clearInterval(signalingHeartbeatHandle);
      signalingHeartbeatHandle = null;
      if (!screenCall.hidden) resetAfterPeerDisconnect("conexão encerrada");
    });
  }

  function resetAfterPeerDisconnect(message) {
    cleanupAndReset();
    showScreen(screenEntry);
    btnEnter.disabled = false;
    btnEnter.querySelector("span").textContent = "conectar";
    entryHint.textContent = "A sessão começa quando os dois entrarem.";
    entryError.textContent = message || "";
    entryError.hidden = !message;
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible" || screenCall.hidden) return;
    requestWakeLock();
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      resetAfterPeerDisconnect("conexão encerrada — conecte novamente");
    }
  });

  function send(msg) {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }

  // ---------- WebRTC ----------
  // Os transceivers permitem iniciar o compartilhamento depois que a conexão
  // já estiver estabelecida, sem capturar dispositivos locais.
  async function createPeerConnection() {
    pc = new RTCPeerConnection({ iceServers: cfg.ICE_SERVERS });

    const audioTransceiver = pc.addTransceiver("audio", {
      direction: "sendrecv",
    });
    const videoTransceiver = pc.addTransceiver("video", {
      direction: "sendrecv",
    });
    audioSender = audioTransceiver.sender;
    videoSender = videoTransceiver.sender;

    pc.addEventListener("icecandidate", (e) => {
      if (e.candidate) send({ type: "ice-candidate", candidate: e.candidate });
    });

    pc.addEventListener("track", (e) => {
      if (e.track.kind === "audio") toast("áudio recebido", 2000);
      if (!remoteStream) remoteStream = new MediaStream();
      const previousTrack = remoteStream
        .getTracks()
        .find((track) => track.kind === e.track.kind);
      if (previousTrack && previousTrack.id !== e.track.id) {
        remoteStream.removeTrack(previousTrack);
      }
      if (!remoteStream.getTracks().some((track) => track.id === e.track.id)) {
        remoteStream.addTrack(e.track);
      }
      remoteVideo.srcObject = remoteStream;
      remoteAudio.srcObject = remoteStream;
      remoteEmpty.classList.add("hidden");
      unlockRemoteAudio();
    });

    pc.addEventListener("connectionstatechange", () => {
      if (pc.connectionState === "connected") {
        setConnectionStatus("conectado");
        toast("conectado ✓", 2000);
      }
      if (["disconnected", "failed"].includes(pc.connectionState)) {
        setConnectionStatus("reconectando");
        toast("conexão instável…");
        scheduleConnectionRecovery();
      }
    });
  }

  function scheduleConnectionRecovery() {
    clearTimeout(connectionRecoveryHandle);
    connectionRecoveryHandle = setTimeout(recoverConnection, 5000);
  }

  async function recoverConnection() {
    if (
      recoveringConnection ||
      !pc ||
      !ws ||
      ws.readyState !== WebSocket.OPEN ||
      !["disconnected", "failed"].includes(pc.connectionState)
    ) {
      return;
    }

    recoveringConnection = true;
    try {
      const offer = await pc.createOffer({ iceRestart: true });
      await pc.setLocalDescription(offer);
      send({ type: "offer", sdp: offer });
      toast("tentando recuperar a conexão…", 4000);
    } catch {
      toast("não foi possível recuperar a conexão");
    } finally {
      recoveringConnection = false;
      if (pc && ["disconnected", "failed"].includes(pc.connectionState)) {
        scheduleConnectionRecovery();
      }
    }
  }

  async function makeOffer() {
    if (!pc) await createPeerConnection();
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    send({ type: "offer", sdp: offer });
  }

  async function handleOffer(sdp) {
    if (!pc) await createPeerConnection();
    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    while (pendingIceCandidates.length) {
      await pc.addIceCandidate(pendingIceCandidates.shift());
    }
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    send({ type: "answer", sdp: answer });
  }

  function startCall() {
    callRoomName.textContent = roomId;
    setConnectionStatus("conectado");
    showScreen(screenCall);
    startTimer();
    requestWakeLock();
    toast("vocês estão conectados — compartilhe sua tela para começar", 4500);
    unlockRemoteAudio();
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

  function hideCallControls() {
    clearTimeout(controlsHideHandle);
    controlsHideHandle = null;
    screenCall.classList.remove("controls-visible");
  }

  function scheduleControlsHide() {
    clearTimeout(controlsHideHandle);
    controlsHideHandle = setTimeout(hideCallControls, controlsVisibleMs);
  }

  stage.addEventListener("pointerup", (event) => {
    if (!landscapeQuery.matches || event.target.closest(".control-bar")) {
      return;
    }

    const controlsAreVisible = screenCall.classList.toggle("controls-visible");
    if (controlsAreVisible) {
      scheduleControlsHide();
    } else {
      clearTimeout(controlsHideHandle);
      controlsHideHandle = null;
    }
  });

  // ---------- controles ----------
  btnAudio.addEventListener("click", unlockRemoteAudio);

  btnShare.addEventListener("click", async () => {
    if (!navigator.mediaDevices.getDisplayMedia) {
      toast(
        "este navegador não permite compartilhar tela (comum no iPhone/iPad)",
      );
      return;
    }

    if (!sharing) {
      btnShare.disabled = true;
      remoteAudioWasMutedBeforeSharing = remoteAudio.muted;
      remoteAudio.muted = true;
      remoteAudioMutedForSharing = true;
      try {
        screenStream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: true,
        });
      } catch (error) {
        if (error?.name !== "AbortError") {
          toast("não foi possível iniciar o compartilhamento");
        }
        restoreRemoteAudioAfterSharing();
        btnShare.disabled = false;
        return; // usuário cancelou o seletor de tela
      }

      const screenTrack = screenStream.getVideoTracks()[0];
      if (!videoSender) {
        toast("conexão ainda não está pronta");
        screenStream.getTracks().forEach((track) => track.stop());
        screenStream = null;
        restoreRemoteAudioAfterSharing();
        btnShare.disabled = false;
        return;
      }
      try {
        await videoSender.replaceTrack(screenTrack);
        await shareScreenAudioOnly();

        screenTrack.addEventListener("ended", stopSharing);

        sharing = true;
        btnShare.setAttribute("aria-pressed", "true");
        shareLabel.textContent = "parar compartilhar";
        toast("compartilhando sua tela");
        await makeOffer();
      } catch {
        await stopSharing();
        toast("não foi possível transmitir sua tela");
      } finally {
        btnShare.disabled = false;
      }
    } else {
      btnShare.disabled = true;
      try {
        await stopSharing();
      } finally {
        btnShare.disabled = false;
      }
    }
  });

  btnFullscreen.addEventListener("click", async () => {
    if (remoteVideo.webkitEnterFullscreen) {
      remoteVideo.webkitEnterFullscreen();
      return;
    }

    if (document.fullscreenElement) {
      await document.exitFullscreen?.();
      return;
    }

    await (stage.requestFullscreen?.() || remoteVideo.requestFullscreen?.());
  });

  btnPip.addEventListener("click", async () => {
    try {
      if (!remoteVideo.srcObject) {
        toast("o vídeo ainda não está disponível");
        return;
      }

      await remoteVideo.play();

      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
        return;
      }

      if (remoteVideo.webkitSetPresentationMode) {
        remoteVideo.webkitSetPresentationMode(
          remoteVideo.webkitPresentationMode === "picture-in-picture"
            ? "inline"
            : "picture-in-picture",
        );
        return;
      }

      if (document.pictureInPictureEnabled && remoteVideo.requestPictureInPicture) {
        await remoteVideo.requestPictureInPicture();
        return;
      }

      toast("janela flutuante não é compatível neste navegador");
    } catch {
      toast("não foi possível abrir a janela flutuante");
    }
  });

  async function stopSharing() {
    if (screenStream) screenStream.getTracks().forEach((t) => t.stop());
    screenStream = null;

    if (videoSender) {
      await videoSender.replaceTrack(null);
    }
    if (audioSender) {
      await audioSender.replaceTrack(null);
    }
    if (shareAudioContext) {
      await shareAudioContext.close();
      shareAudioContext = null;
      mixedAudioTrack = null;
    }

    restoreRemoteAudioAfterSharing();

    if (videoSender) {
      await makeOffer();
    }

    sharing = false;
    btnShare.setAttribute("aria-pressed", "false");
    shareLabel.textContent = "compartilhar tela";
  }

  async function shareScreenAudioOnly() {
    const screenAudioTrack = screenStream?.getAudioTracks()[0];
    if (!audioSender) {
      toast("conexão ainda não está pronta", 3000);
      return;
    }
    if (!screenAudioTrack) {
      await audioSender.replaceTrack(null);
      restoreRemoteAudioAfterSharing();
      toast("selecione uma aba e marque compartilhar áudio", 3000);
      return;
    }

    shareAudioContext = new AudioContext();
    const destination = shareAudioContext.createMediaStreamDestination();
    const screenSource = shareAudioContext.createMediaStreamSource(
      new MediaStream([screenAudioTrack]),
    );
    screenSource.connect(destination);
    mixedAudioTrack = destination.stream.getAudioTracks()[0];
    await audioSender.replaceTrack(mixedAudioTrack);
    toast("áudio do filme sendo transmitido pelo site", 2500);
  }

  function restoreRemoteAudioAfterSharing() {
    if (!remoteAudioMutedForSharing) return;
    remoteAudio.muted = remoteAudioWasMutedBeforeSharing;
    remoteAudioMutedForSharing = false;
    unlockRemoteAudio();
  }

  btnLeave.addEventListener("click", () => {
    send({ type: "leave" });
    cleanupAndReset();
    location.reload();
  });

  function cleanupAndReset() {
    clearInterval(timerHandle);
    clearTimeout(signalingTimeoutHandle);
    clearTimeout(connectionRecoveryHandle);
    clearInterval(signalingHeartbeatHandle);
    releaseWakeLock();
    signalingTimeoutHandle = null;
    connectionRecoveryHandle = null;
    signalingHeartbeatHandle = null;
    recoveringConnection = false;
    hideCallControls();
    if (pc) pc.close();
    if (screenStream) screenStream.getTracks().forEach((t) => t.stop());
    if (shareAudioContext) shareAudioContext.close();
    if (ws) ws.close();
    pc = null;
    ws = null;
    remoteStream = null;
    screenStream = null;
    shareAudioContext = null;
    mixedAudioTrack = null;
    audioSender = null;
    videoSender = null;
    pendingIceCandidates.length = 0;
    sharing = false;
    btnShare.disabled = false;
    btnShare.setAttribute("aria-pressed", "false");
    shareLabel.textContent = "compartilhar tela";
    remoteVideo.srcObject = null;
    remoteAudio.srcObject = null;
  }

  // registra o service worker (deixa o app instalável / abrindo rápido)
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    });
  }
})();
