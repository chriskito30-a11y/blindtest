import { $, normalizeRoomId, randomRoomId, ensureRoom, verifyRoomPassword, rememberPassword, publicUrl, setStatus } from "./core.js";

const roomInput = $("#roomInput");
const passwordInput = $("#passwordInput");
const form = $("#roomForm");
const randomBtn = $("#randomRoomBtn");
const status = $("#status");

roomInput.value = randomRoomId();

randomBtn.addEventListener("click", () => {
  roomInput.value = randomRoomId();
  roomInput.focus();
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const roomId = normalizeRoomId(roomInput.value);
  const password = passwordInput.value;
  setStatus(status, "Création / ouverture de la partie...");

  try {
    if (!roomId) throw new Error("Choisis un nom de partie valide.");
    if (!password || password.length < 4) throw new Error("Le mot de passe doit contenir au moins 4 caractères.");

    const result = await ensureRoom(roomId, password);
    if (!result.created) {
      const ok = await verifyRoomPassword(roomId, password);
      if (!ok) throw new Error("Cette partie existe déjà, mais le mot de passe est incorrect.");
    }

    rememberPassword(roomId, password);
    window.location.href = publicUrl("settings.html", roomId);
  } catch (error) {
    setStatus(status, error.message || "Impossible d'ouvrir la partie.", "error");
  }
});
