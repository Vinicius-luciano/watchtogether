// Service worker simples: cacheia o "casco" do app (HTML/CSS/JS) pra abrir rápido.
// Não cacheia nada de vídeo/áudio - isso nunca passa por aqui.

const CACHE_NAME = "sessao-shell-v6";
const SHELL_FILES = [
  "./index.html",
  "./style.css",
  "./app.js",
  "./config.js",
  "./manifest.json",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)),
        ),
      ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  // só intercepta GET do próprio app - deixa tudo de WebSocket/WebRTC intocado
  if (event.request.method !== "GET") return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      return (
        cached || fetch(event.request).catch(() => caches.match("./index.html"))
      );
    }),
  );
});
