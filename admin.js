import { db, ref, get, set, update, onValue } from "./firebase-config.js";
import {
  $,
  getRoomIdFromUrl,
  getRememberedPassword,
  rememberPassword,
  verifyRoomPassword,
  roomPath,
  safeConfig,
  safeTeams,
  safePlayers,
  safeAnswers,
  acceptedAnswers,
  remainingSeconds,
  isRoundOpen,
  formatTimer,
  publicUrl,
  extractYouTubeId,
  youtubeWatchUrl,
  answerModeLabel,
  expectedAnswerText,
  normalizeAnswer,
  parseYouTubeTitleGuess,
  evaluateAnswerParts,
  missingRequiredParts,
  allRequiredPartsFound,
  partLabel,
  partPoints,
  foundPartsSummary,
  defaultRound,
  clampDuration,
  setStatus
} from "./core.js";

const roomId = getRoomIdFromUrl();
let config = safeConfig();
let teams = [];
let players = [];
let currentRound = defaultRound();
let secretRound = { artist: "", title: "", answerMode: "artist_title" };
let selectedVideo = { videoId: "", title: "", url: "" };
let timerId = null;
let ytPlayer = null;
let playerReady = false;
let autoPausedRoundId = "";
let autoFinishRoundId = "";
let autoProcessingAnswerId = "";
let preparedTracks = [];
let currentPreparedIndex = -1;
let playlistModeActive = false;
let activePlaylistRoundId = "";
let activePlaylistRoundIndex = -1;
let autoAdvanceRoundId = "";

const apiKeyStorageKey = "blindMasterYoutubeApiKey";
const playlistStorageKey = `blindMasterPreparedTracks:${roomId}`;
const playlistAutoPlayStorageKey = `blindMasterPlaylistAutoPlay:${roomId}`;

if (!roomId) {
  $("#missingRoom").hidden = false;
} else {
  $("#authRoomName").textContent = roomId;
  bootAuth();
}

async function bootAuth() {
  const remembered = getRememberedPassword(roomId);
  if (remembered && await verifyRoomPassword(roomId, remembered)) {
    openAdmin();
    return;
  }
  $("#authPanel").hidden = false;
  $("#authPassword").focus();
}

$("#authForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const password = $("#authPassword").value;
  const ok = await verifyRoomPassword(roomId, password);
  if (!ok) {
    setStatus($("#authError"), "Mot de passe incorrect.", "error");
    return;
  }
  rememberPassword(roomId, password);
  openAdmin();
});

function openYoutubeApiHelp() {
  const modal = $("#youtubeApiHelpModal");
  if (!modal) return;
  modal.hidden = false;
  document.body.classList.add("modal-open");
  $("#youtubeApiHelpCloseBtn")?.focus();
}

function closeYoutubeApiHelp() {
  const modal = $("#youtubeApiHelpModal");
  if (!modal) return;
  modal.hidden = true;
  document.body.classList.remove("modal-open");
  $("#youtubeApiHelpBtn")?.focus();
}

function openYoutubeAdsHelp() {
  const modal = $("#youtubeAdsHelpModal");
  if (!modal) return;
  modal.hidden = false;
  document.body.classList.add("modal-open");
  $("#youtubeAdsHelpCloseBtn")?.focus();
}

function closeYoutubeAdsHelp() {
  const modal = $("#youtubeAdsHelpModal");
  if (!modal) return;
  modal.hidden = true;
  document.body.classList.remove("modal-open");
  $("#youtubeAdsHelpBtn")?.focus();
}

function openAdmin() {
  $("#authPanel").hidden = true;
  $("#adminPanel").hidden = false;
  $("#settingsLink").href = publicUrl("settings.html", roomId);
  $("#screenLink").href = publicUrl("screen.html", roomId);
  $("#voteLink").href = publicUrl("vote.html", roomId);
  $("#youtubeApiKeyInput").value = localStorage.getItem(apiKeyStorageKey) || "";
  loadPreparedTracks();
  if ($("#playlistAutoPlayInput")) {
    $("#playlistAutoPlayInput").checked = localStorage.getItem(playlistAutoPlayStorageKey) === "1";
  }

  bindControls();

  onValue(ref(db, roomPath(roomId, "config")), (snap) => {
    config = safeConfig(snap.val() || {});
    render();
  });
  onValue(ref(db, roomPath(roomId, "teams")), (snap) => {
    teams = safeTeams(snap.val() || {});
    render();
  });
  onValue(ref(db, roomPath(roomId, "players")), (snap) => {
    players = safePlayers(snap.val() || {});
    render();
  });
  onValue(ref(db, roomPath(roomId, "currentRound")), (snap) => {
    currentRound = { ...defaultRound(), ...(snap.val() || {}) };
    render();
  });
  onValue(ref(db, roomPath(roomId, "private/currentRoundSecret")), (snap) => {
    secretRound = { artist: "", title: "", answerMode: currentRound.answerMode || "artist_title", ...(snap.val() || {}) };
    render();
  });

  timerId = setInterval(render, 250);
}

function bindControls() {
  $("#saveApiKeyBtn").addEventListener("click", () => {
    const key = $("#youtubeApiKeyInput").value.trim();
    if (key) localStorage.setItem(apiKeyStorageKey, key);
    else localStorage.removeItem(apiKeyStorageKey);
    setStatus($("#youtubeStatus"), key ? "Clé API mémorisée sur cet appareil." : "Clé API supprimée de cet appareil.", "success");
  });

  $("#youtubeApiHelpBtn")?.addEventListener("click", openYoutubeApiHelp);
  $("#youtubeApiHelpCloseBtn")?.addEventListener("click", closeYoutubeApiHelp);
  $("#youtubeApiHelpModal")?.addEventListener("click", (event) => {
    if (event.target?.id === "youtubeApiHelpModal") closeYoutubeApiHelp();
  });
  $("#youtubeAdsHelpBtn")?.addEventListener("click", openYoutubeAdsHelp);
  $("#youtubeAdsHelpCloseBtn")?.addEventListener("click", closeYoutubeAdsHelp);
  $("#youtubeAdsHelpModal")?.addEventListener("click", (event) => {
    if (event.target?.id === "youtubeAdsHelpModal") closeYoutubeAdsHelp();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !$("#youtubeApiHelpModal")?.hidden) closeYoutubeApiHelp();
    if (event.key === "Escape" && !$("#youtubeAdsHelpModal")?.hidden) closeYoutubeAdsHelp();
  });

  $("#youtubeSearchForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    await searchYoutube();
  });

  $("#openYoutubeBtn").addEventListener("click", () => {
    const q = $("#youtubeQueryInput").value.trim() || [$("#artistInput").value, $("#titleInput").value].filter(Boolean).join(" ") || "blind test musique";
    window.open(`https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`, "_blank", "noopener");
  });

  $("#useYoutubeUrlBtn").addEventListener("click", async () => {
    const videoId = extractYouTubeId($("#youtubeUrlInput").value);
    if (!videoId) {
      setStatus($("#youtubeStatus"), "Lien YouTube ou ID vidéo invalide.", "error");
      return;
    }
    const details = await getYoutubeVideoDetails(videoId);
    setSelectedVideo({
      videoId,
      title: details?.title || "Vidéo YouTube sélectionnée",
      channel: details?.channel || "",
      url: youtubeWatchUrl(videoId, $("#youtubeStartInput").value)
    });
  });

  $("#cueBtn").addEventListener("click", () => cueSelectedVideo());
  $("#playBtn").addEventListener("click", () => ytPlayer?.playVideo?.());
  $("#pauseBtn").addEventListener("click", () => ytPlayer?.pauseVideo?.());
  $("#stopBtn").addEventListener("click", () => ytPlayer?.stopVideo?.());

  $("#startRoundBtn").addEventListener("click", startRoundFromMainButton);
  $("#closeRoundBtn").addEventListener("click", closeRound);
  $("#revealRoundBtn").addEventListener("click", () => revealRound("manual"));
  $("#resetRoundBtn").addEventListener("click", resetRound);
  $("#resetScoresBtn").addEventListener("click", resetScores);

  $("#playerVolumeInput")?.addEventListener("input", () => {
    const value = readPlayerVolumeInput();
    localStorage.setItem(`blindMasterPlayerVolume:${roomId}`, String(value));
    applyPlayerVolume(value);
  });
  $("#volumeDown10Btn")?.addEventListener("click", () => adjustPlayerVolume(-10));
  $("#volumeUp10Btn")?.addEventListener("click", () => adjustPlayerVolume(10));
  $("#saveTrackVolumeBtn")?.addEventListener("click", saveVolumeForCurrentPreparedTrack);
  $("#applyVolumeToAllBtn")?.addEventListener("click", applyCurrentVolumeToAllPreparedTracks);
  $("#addPreparedTrackBtn")?.addEventListener("click", addPreparedTrackFromCurrent);
  $("#startPlaylistBtn")?.addEventListener("click", startPreparedPlaylist);
  $("#startCurrentTrackBtn")?.addEventListener("click", startCurrentPreparedTrack);
  $("#loadNextTrackBtn")?.addEventListener("click", () => prepareNextPlaylistTrack(getPlaylistBaseIndex(), { manual: true }));
  $("#playlistAutoPlayInput")?.addEventListener("change", () => {
    localStorage.setItem(playlistAutoPlayStorageKey, $("#playlistAutoPlayInput").checked ? "1" : "0");
    setStatus(
      $("#playlistStatus"),
      $("#playlistAutoPlayInput").checked
        ? "Lecture automatique activée : à la fin d’une manche, le morceau suivant sera lancé tout seul."
        : "Lecture automatique désactivée : le morceau suivant sera seulement préchargé, prêt à lancer.",
      "success"
    );
  });
  $("#clearPlaylistBtn")?.addEventListener("click", clearPreparedTracks);
}

function clampVolume(value, fallback = 70) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return Math.min(100, Math.max(0, Number.parseInt(fallback, 10) || 70));
  return Math.min(100, Math.max(0, parsed));
}

function getDefaultPlayerVolume() {
  const saved = localStorage.getItem(`blindMasterPlayerVolume:${roomId}`);
  const fallback = config.youtubePlayerVolume ?? 70;
  return clampVolume(saved ?? fallback, fallback);
}

function readPlayerVolumeInput() {
  return clampVolume($("#playerVolumeInput")?.value, getDefaultPlayerVolume());
}

function setPlayerVolumeInput(volume) {
  const value = clampVolume(volume, getDefaultPlayerVolume());
  if ($("#playerVolumeInput")) $("#playerVolumeInput").value = value;
  return value;
}

function getPlayerVolume() {
  return readPlayerVolumeInput();
}

function applyPlayerVolume(volume = null) {
  const value = volume === null ? getPlayerVolume() : setPlayerVolumeInput(volume);
  if (ytPlayer?.setVolume) ytPlayer.setVolume(value);
  // YouTube peut parfois rester en muet après un cue/load ou après une prélecture.
  // On force donc explicitement la sortie du mode muet à chaque application du volume.
  if (ytPlayer?.unMute) ytPlayer.unMute();
  return value;
}

function refreshPlayerAudio(volume = null) {
  const value = applyPlayerVolume(volume);
  // Certains changements YouTube réinitialisent le volume quelques instants après loadVideoById/cueVideoById.
  // On le réapplique légèrement après pour sécuriser le morceau suivant de la playlist.
  window.setTimeout(() => applyPlayerVolume(value), 250);
  window.setTimeout(() => applyPlayerVolume(value), 900);
  return value;
}

function playYoutubeWithAudio() {
  if (!ytPlayer) return;
  refreshPlayerAudio();
  ytPlayer.playVideo?.();
  window.setTimeout(() => refreshPlayerAudio(), 250);
}

function adjustPlayerVolume(delta) {
  const next = clampVolume(readPlayerVolumeInput() + delta, getDefaultPlayerVolume());
  localStorage.setItem(`blindMasterPlayerVolume:${roomId}`, String(next));
  applyPlayerVolume(next);
  setStatus($("#playlistStatus"), `Volume courant : ${next} %. Clique sur “Mémoriser pour ce morceau” pour l’enregistrer dans la liste.`, "success");
}

function saveVolumeForCurrentPreparedTrack() {
  if (currentPreparedIndex < 0 || !preparedTracks[currentPreparedIndex]) {
    setStatus($("#playlistStatus"), "Charge d’abord un morceau de la liste, puis règle son volume.", "error");
    return;
  }
  const volume = readPlayerVolumeInput();
  preparedTracks[currentPreparedIndex].volume = volume;
  savePreparedTracks();
  applyPlayerVolume(volume);
  setStatus($("#playlistStatus"), `Volume ${volume} % mémorisé pour : ${preparedTracks[currentPreparedIndex].artist} — ${preparedTracks[currentPreparedIndex].title}.`, "success");
}

function applyCurrentVolumeToAllPreparedTracks() {
  if (!preparedTracks.length) {
    setStatus($("#playlistStatus"), "Ajoute au moins un morceau avant d’appliquer un volume à la liste.", "error");
    return;
  }
  const volume = readPlayerVolumeInput();
  preparedTracks = preparedTracks.map((track) => ({ ...track, volume }));
  savePreparedTracks();
  applyPlayerVolume(volume);
  setStatus($("#playlistStatus"), `Volume ${volume} % appliqué à toute la liste préparée.`, "success");
}

function loadPreparedTracks() {
  try {
    preparedTracks = JSON.parse(localStorage.getItem(playlistStorageKey) || "[]");
  } catch {
    preparedTracks = [];
  }
  if (!Array.isArray(preparedTracks)) preparedTracks = [];
  preparedTracks = preparedTracks.filter((track) => track?.videoId);
  renderPreparedTracks();
}

function savePreparedTracks() {
  localStorage.setItem(playlistStorageKey, JSON.stringify(preparedTracks));
  renderPreparedTracks();
}

function isPlaylistAutoPlayEnabled() {
  return $("#playlistAutoPlayInput")?.checked === true;
}

function getPlaylistBaseIndex() {
  const roundIndex = Number(currentRound?.playlistIndex);
  if (Number.isFinite(roundIndex) && roundIndex >= 0) return roundIndex;
  return currentPreparedIndex;
}

function trackFromCurrent() {
  const videoId = selectedVideo.videoId || extractYouTubeId($("#youtubeUrlInput").value);
  if (!videoId) throw new Error("Sélectionne ou colle une vidéo YouTube avant d’ajouter le morceau.");
  const artist = $("#artistInput").value.trim();
  const title = $("#titleInput").value.trim();
  if (!artist || !title) throw new Error("Renseigne l’artiste et le titre avant d’ajouter le morceau.");
  return {
    id: `track-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    videoId,
    youtubeTitle: selectedVideo.title || "Vidéo YouTube sélectionnée",
    channel: selectedVideo.channel || "",
    artist,
    title,
    start: Number.parseInt($("#youtubeStartInput").value, 10) || 0,
    durationSec: clampDuration($("#durationInput").value || config.durationSec),
    volume: readPlayerVolumeInput(),
    answerMode: $("#answerModeInput").value || config.answerMode,
    answerInputMode: $("#answerInputModeInput").value || config.answerInputMode || "text"
  };
}

function addPreparedTrackFromCurrent() {
  try {
    const track = trackFromCurrent();
    preparedTracks.push(track);
    currentPreparedIndex = preparedTracks.length - 1;
    savePreparedTracks();
    setStatus($("#playlistStatus"), `Morceau ajouté : ${track.artist} — ${track.title}.`, "success");
  } catch (error) {
    setStatus($("#playlistStatus"), error.message || "Impossible d’ajouter le morceau.", "error");
  }
}

function clearPreparedTracks() {
  preparedTracks = [];
  currentPreparedIndex = -1;
  playlistModeActive = false;
  activePlaylistRoundId = "";
  activePlaylistRoundIndex = -1;
  savePreparedTracks();
  setStatus($("#playlistStatus"), "Liste vidée.", "success");
}

async function loadPreparedTrack(index, cue = true) {
  const track = preparedTracks[index];
  if (!track) return false;
  currentPreparedIndex = index;
  selectedVideo = {
    videoId: track.videoId,
    title: track.youtubeTitle || `${track.artist} — ${track.title}`,
    channel: track.channel || "",
    url: youtubeWatchUrl(track.videoId, track.start || 0)
  };
  $("#youtubeUrlInput").value = selectedVideo.url;
  $("#selectedVideoLabel").textContent = `Vidéo : ${selectedVideo.title}`;
  $("#artistInput").value = track.artist || "";
  $("#titleInput").value = track.title || "";
  $("#youtubeStartInput").value = Number(track.start || 0);
  $("#durationInput").value = clampDuration(track.durationSec || config.durationSec);
  $("#answerModeInput").value = track.answerMode || config.answerMode;
  $("#answerInputModeInput").value = track.answerInputMode || config.answerInputMode || "text";
  const volume = clampVolume(track.volume ?? getDefaultPlayerVolume(), getDefaultPlayerVolume());
  setPlayerVolumeInput(volume);
  await ensurePlayer(track.videoId);
  applyPlayerVolume(volume);
  if (cue) cueSelectedVideo();
  renderPreparedTracks();
  return true;
}

async function startPreparedPlaylist() {
  if (!preparedTracks.length) {
    setStatus($("#playlistStatus"), "Ajoute au moins un morceau dans la liste.", "error");
    return;
  }
  playlistModeActive = true;
  activePlaylistRoundId = "";
  activePlaylistRoundIndex = -1;
  autoAdvanceRoundId = "";
  currentPreparedIndex = 0;
  await loadPreparedTrack(0, true);
  setStatus(
    $("#playlistStatus"),
    `Liste prête : morceau 1/${preparedTracks.length} préchargé (${preparedTracks[0].artist} — ${preparedTracks[0].title}). Clique sur “Lancer la manche + YouTube” quand l’arbitre veut jouer.`,
    "success"
  );
}

async function startCurrentPreparedTrack() {
  if (!preparedTracks.length) {
    setStatus($("#playlistStatus"), "Ajoute au moins un morceau dans la liste.", "error");
    return false;
  }
  const index = currentPreparedIndex >= 0 ? currentPreparedIndex : 0;
  const track = preparedTracks[index];
  if (!track) {
    setStatus($("#playlistStatus"), "Aucun morceau prêt à lancer.", "error");
    return false;
  }

  playlistModeActive = true;
  await loadPreparedTrack(index, true);
  const payload = await startRound({ playlistIndex: index, playlistTrackId: track.id || "" });
  if (!payload) return false;

  activePlaylistRoundId = payload.roundId;
  activePlaylistRoundIndex = index;
  setStatus($("#playlistStatus"), `Morceau ${index + 1}/${preparedTracks.length} lancé : ${track.artist} — ${track.title}.`, "success");
  return true;
}

async function prepareNextPlaylistTrack(fromIndex = -1, options = {}) {
  const base = Number.isFinite(Number(fromIndex)) ? Number(fromIndex) : -1;
  const nextIndex = base + 1;
  if (!preparedTracks[nextIndex]) {
    setStatus($("#playlistStatus"), "Fin de la liste préparée.", "success");
    return false;
  }
  await loadPreparedTrack(nextIndex, true);
  const suffix = isPlaylistAutoPlayEnabled() && !options.manual
    ? "Lecture automatique activée."
    : "Il est prêt : clique sur “Lancer le morceau prêt” ou sur Lecture.";
  setStatus($("#playlistStatus"), `Morceau suivant préchargé : ${preparedTracks[nextIndex].artist} — ${preparedTracks[nextIndex].title}. ${suffix}`, "success");
  return nextIndex;
}

async function handlePlaylistAfterRoundEnd(fromIndex, roundId = "") {
  const endedRoundId = roundId || currentRound?.roundId || activePlaylistRoundId || "";
  if (!playlistModeActive || !endedRoundId || autoAdvanceRoundId === endedRoundId) return;
  autoAdvanceRoundId = endedRoundId;

  const baseIndex = Number.isFinite(Number(fromIndex)) && Number(fromIndex) >= 0
    ? Number(fromIndex)
    : activePlaylistRoundIndex;

  const nextIndex = await prepareNextPlaylistTrack(baseIndex);
  if (nextIndex === false) {
    playlistModeActive = false;
    activePlaylistRoundId = "";
    activePlaylistRoundIndex = -1;
    return;
  }

  activePlaylistRoundId = "";
  activePlaylistRoundIndex = -1;
  if (!isPlaylistAutoPlayEnabled()) return;

  await new Promise((resolve) => window.setTimeout(resolve, 1200));
  if (!preparedTracks[nextIndex] || currentPreparedIndex !== nextIndex || !playlistModeActive) return;
  await startCurrentPreparedTrack();
}

function renderPreparedTracks() {
  const list = $("#playlistList");
  if (!list) return;
  list.innerHTML = "";

  if (!preparedTracks.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "Aucun morceau préparé pour le moment.";
    list.appendChild(empty);
    return;
  }

  const header = document.createElement("div");
  header.className = "playlist-summary";
  header.innerHTML = `<strong>${preparedTracks.length} morceau${preparedTracks.length > 1 ? "x" : ""} préparé${preparedTracks.length > 1 ? "s" : ""}</strong><span>Tu peux modifier directement les champs ci-dessous, puis cliquer sur “Enregistrer”.</span>`;
  list.appendChild(header);

  preparedTracks.forEach((track, index) => {
    const row = document.createElement("article");
    row.className = "playlist-row editable";
    if (index === currentPreparedIndex) row.classList.add("active");

    const titleLine = document.createElement("div");
    titleLine.className = "playlist-row-title";
    const title = document.createElement("strong");
    title.textContent = `${index + 1}. ${track.artist || "Artiste ?"} — ${track.title || "Titre ?"}`;
    const meta = document.createElement("small");
    meta.textContent = `Vidéo : ${track.youtubeTitle || track.videoId} · ${track.answerInputMode === "buzzer" ? "buzzer oral" : "réponse écrite"}`;
    titleLine.append(title, meta);

    const form = document.createElement("div");
    form.className = "playlist-edit-grid";

    const artistInput = makePlaylistInput("Artiste", track.artist || "");
    const titleInput = makePlaylistInput("Titre", track.title || "");
    const startInput = makePlaylistInput("Début s", Number(track.start || 0), "number", { min: 0, step: 1 });
    const durationInput = makePlaylistInput("Durée s", clampDuration(track.durationSec || config.durationSec), "number", { min: 5, max: 180, step: 1 });
    const volumeInput = makePlaylistInput("Volume %", clampVolume(track.volume ?? getDefaultPlayerVolume(), getDefaultPlayerVolume()), "number", { min: 0, max: 100, step: 1 });

    const answerModeWrap = makePlaylistSelect("Réponse", track.answerMode || config.answerMode || "artist_title", [
      ["artist_title", "Artiste + titre"],
      ["title", "Titre"],
      ["artist", "Artiste"]
    ]);
    const inputModeWrap = makePlaylistSelect("Mode joueur", track.answerInputMode || config.answerInputMode || "text", [
      ["text", "Écrit"],
      ["buzzer", "Buzzer"]
    ]);

    form.append(artistInput.wrap, titleInput.wrap, startInput.wrap, durationInput.wrap, volumeInput.wrap, answerModeWrap.wrap, inputModeWrap.wrap);

    const actions = document.createElement("div");
    actions.className = "tiny-actions playlist-actions";

    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "secondary-btn";
    saveBtn.textContent = "Enregistrer";
    saveBtn.addEventListener("click", () => {
      const updated = {
        ...track,
        artist: artistInput.input.value.trim(),
        title: titleInput.input.value.trim(),
        start: Math.max(0, Number.parseInt(startInput.input.value, 10) || 0),
        durationSec: clampDuration(durationInput.input.value || config.durationSec),
        volume: clampVolume(volumeInput.input.value, getDefaultPlayerVolume()),
        answerMode: answerModeWrap.select.value || "artist_title",
        answerInputMode: inputModeWrap.select.value || "text"
      };
      if (!updated.artist || !updated.title) {
        setStatus($("#playlistStatus"), "Artiste et titre sont obligatoires pour enregistrer ce morceau.", "error");
        return;
      }
      preparedTracks[index] = updated;
      savePreparedTracks();
      if (currentPreparedIndex === index) loadPreparedTrack(index, true);
      setStatus($("#playlistStatus"), `Morceau ${index + 1} mis à jour : ${updated.artist} — ${updated.title}.`, "success");
    });

    const loadBtn = document.createElement("button");
    loadBtn.type = "button";
    loadBtn.textContent = "Charger";
    loadBtn.addEventListener("click", () => loadPreparedTrack(index, true));

    const startBtn = document.createElement("button");
    startBtn.type = "button";
    startBtn.textContent = "Lancer";
    startBtn.addEventListener("click", async () => {
      await loadPreparedTrack(index, true);
      await startRound({ playlistIndex: index, playlistTrackId: track.id });
    });

    const duplicateBtn = document.createElement("button");
    duplicateBtn.type = "button";
    duplicateBtn.textContent = "Dupliquer";
    duplicateBtn.addEventListener("click", () => {
      const copy = { ...preparedTracks[index], id: `track-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` };
      preparedTracks.splice(index + 1, 0, copy);
      currentPreparedIndex = index + 1;
      savePreparedTracks();
      setStatus($("#playlistStatus"), "Morceau dupliqué.", "success");
    });

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "danger-btn";
    removeBtn.textContent = "Supprimer";
    removeBtn.addEventListener("click", () => {
      preparedTracks.splice(index, 1);
      if (currentPreparedIndex === index) currentPreparedIndex = -1;
      else if (currentPreparedIndex > index) currentPreparedIndex -= 1;
      savePreparedTracks();
      setStatus($("#playlistStatus"), "Morceau supprimé de la liste.", "success");
    });

    actions.append(saveBtn, loadBtn, startBtn, duplicateBtn, removeBtn);
    row.append(titleLine, form, actions);
    list.appendChild(row);
  });
}

function makePlaylistInput(labelText, value, type = "text", attrs = {}) {
  const wrap = document.createElement("label");
  wrap.className = "playlist-edit-field";
  const span = document.createElement("span");
  span.textContent = labelText;
  const input = document.createElement("input");
  input.type = type;
  input.value = value;
  Object.entries(attrs).forEach(([key, attrValue]) => input.setAttribute(key, attrValue));
  wrap.append(span, input);
  return { wrap, input };
}

function makePlaylistSelect(labelText, value, options) {
  const wrap = document.createElement("label");
  wrap.className = "playlist-edit-field";
  const span = document.createElement("span");
  span.textContent = labelText;
  const select = document.createElement("select");
  options.forEach(([optionValue, optionLabel]) => {
    const option = document.createElement("option");
    option.value = optionValue;
    option.textContent = optionLabel;
    if (optionValue === value) option.selected = true;
    select.appendChild(option);
  });
  wrap.append(span, select);
  return { wrap, select };
}


async function searchYoutube() {
  const query = $("#youtubeQueryInput").value.trim();
  const apiKey = $("#youtubeApiKeyInput").value.trim() || localStorage.getItem(apiKeyStorageKey) || "";
  const resultsEl = $("#youtubeResults");
  resultsEl.innerHTML = "";

  if (!query) {
    setStatus($("#youtubeStatus"), "Tape une recherche YouTube.", "error");
    return;
  }
  if (!apiKey) {
    setStatus($("#youtubeStatus"), "Recherche intégrée inactive : colle une clé YouTube Data API, ou utilise le bouton “Ouvrir YouTube” puis colle le lien de la vidéo.", "error");
    return;
  }

  setStatus($("#youtubeStatus"), "Recherche YouTube...");
  try {
    const url = new URL("https://www.googleapis.com/youtube/v3/search");
    url.searchParams.set("part", "snippet");
    url.searchParams.set("type", "video");
    url.searchParams.set("maxResults", "8");
    url.searchParams.set("q", query);
    url.searchParams.set("key", apiKey);
    const response = await fetch(url.href);
    if (!response.ok) throw new Error(`YouTube API : ${response.status}`);
    const data = await response.json();
    const items = data.items || [];
    if (!items.length) {
      setStatus($("#youtubeStatus"), "Aucun résultat trouvé.");
      return;
    }
    setStatus($("#youtubeStatus"), `${items.length} résultat${items.length > 1 ? "s" : ""}.`, "success");
    renderYoutubeResults(items);
  } catch (error) {
    setStatus($("#youtubeStatus"), `${error.message || "Recherche impossible"}. Vérifie la clé API et les restrictions HTTP.`, "error");
  }
}

function renderYoutubeResults(items) {
  const resultsEl = $("#youtubeResults");
  resultsEl.innerHTML = "";
  items.forEach((item) => {
    const videoId = item?.id?.videoId;
    if (!videoId) return;
    const title = decodeEntities(item?.snippet?.title || "Vidéo YouTube");
    const channel = decodeEntities(item?.snippet?.channelTitle || "");
    const thumb = item?.snippet?.thumbnails?.medium?.url || item?.snippet?.thumbnails?.default?.url || "";
    const card = document.createElement("button");
    card.type = "button";
    card.className = "youtube-result";
    const img = document.createElement("img");
    img.alt = "Miniature YouTube";
    img.src = thumb;
    const body = document.createElement("span");
    const strong = document.createElement("strong");
    strong.textContent = title;
    const small = document.createElement("small");
    small.textContent = channel;
    body.append(strong, small);
    card.append(img, body);
    card.addEventListener("click", () => setSelectedVideo({ videoId, title, channel, url: youtubeWatchUrl(videoId, $("#youtubeStartInput").value) }));
    resultsEl.appendChild(card);
  });
}

function decodeEntities(text) {
  const el = document.createElement("textarea");
  el.innerHTML = text;
  return el.value;
}

async function getYoutubeVideoDetails(videoId) {
  const apiKey = $("#youtubeApiKeyInput").value.trim() || localStorage.getItem(apiKeyStorageKey) || "";
  if (!apiKey) return null;
  try {
    const url = new URL("https://www.googleapis.com/youtube/v3/videos");
    url.searchParams.set("part", "snippet");
    url.searchParams.set("id", videoId);
    url.searchParams.set("key", apiKey);
    const response = await fetch(url.href);
    if (!response.ok) return null;
    const data = await response.json();
    const item = data.items?.[0];
    if (!item?.snippet) return null;
    return {
      title: decodeEntities(item.snippet.title || ""),
      channel: decodeEntities(item.snippet.channelTitle || "")
    };
  } catch {
    return null;
  }
}

function loadYoutubeApi() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  return new Promise((resolve) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (typeof previous === "function") previous();
      resolve(window.YT);
    };
    if (!document.querySelector("script[data-youtube-iframe-api]")) {
      const script = document.createElement("script");
      script.src = "https://www.youtube.com/iframe_api";
      script.dataset.youtubeIframeApi = "true";
      document.head.appendChild(script);
    }
  });
}

async function ensurePlayer(videoId = "") {
  await loadYoutubeApi();
  if (ytPlayer) return ytPlayer;
  ytPlayer = new window.YT.Player("youtubePlayer", {
    width: "100%",
    height: "100%",
    videoId: videoId || undefined,
    playerVars: {
      playsinline: 1,
      rel: 0,
      modestbranding: 1,
      enablejsapi: 1
    },
    events: {
      onReady: () => {
        playerReady = true;
        applyPlayerVolume();
        if (selectedVideo.videoId) cueSelectedVideo();
      }
    }
  });
  return ytPlayer;
}

async function setSelectedVideo(video) {
  selectedVideo = {
    videoId: video.videoId,
    title: video.title || "Vidéo YouTube sélectionnée",
    channel: video.channel || "",
    url: video.url || youtubeWatchUrl(video.videoId, $("#youtubeStartInput").value)
  };
  $("#youtubeUrlInput").value = selectedVideo.url;
  $("#selectedVideoLabel").textContent = `Vidéo : ${selectedVideo.title}`;
  autoFillExpectedFromVideo(selectedVideo.title, selectedVideo.channel);
  await ensurePlayer(selectedVideo.videoId);
  cueSelectedVideo();
}

function autoFillExpectedFromVideo(title, channel = "") {
  const guess = parseYouTubeTitleGuess(title, channel);
  if (!guess.artist && !guess.title) {
    setStatus($("#youtubeStatus"), "Vidéo sélectionnée. Impossible de deviner artiste/titre : renseigne-les manuellement.", "error");
    return;
  }
  if (guess.artist) $("#artistInput").value = guess.artist;
  if (guess.title) $("#titleInput").value = guess.title;
  const bits = [guess.artist, guess.title].filter(Boolean).join(" — ");
  setStatus($("#youtubeStatus"), `Vidéo sélectionnée. Réponse préremplie : ${bits}. Vérifie avant de lancer.`, "success");
}

function cueSelectedVideo() {
  if (!selectedVideo.videoId || !ytPlayer || !playerReady) return;
  const start = Number.parseInt($("#youtubeStartInput").value, 10) || 0;
  ytPlayer.cueVideoById({ videoId: selectedVideo.videoId, startSeconds: start });
  refreshPlayerAudio();
}

async function startRoundFromMainButton() {
  const track = preparedTracks[currentPreparedIndex];

  // Si une liste a été lancée, le gros bouton joue toujours le morceau courant
  // du curseur de playlist, même si les champs du formulaire contiennent autre chose.
  if (playlistModeActive && track?.videoId) {
    await startCurrentPreparedTrack();
    return;
  }

  // Sécurité : si un morceau de la liste est explicitement chargé, on le lance aussi
  // comme morceau de playlist pour garder l'index et passer au suivant ensuite.
  if (track?.videoId && selectedVideo.videoId === track.videoId) {
    await startCurrentPreparedTrack();
    return;
  }

  activePlaylistRoundId = "";
  activePlaylistRoundIndex = -1;
  await startRound();
}

async function startRound(options = {}) {
  const artist = $("#artistInput").value.trim();
  const title = $("#titleInput").value.trim();
  const durationSec = clampDuration($("#durationInput").value || config.durationSec);
  const answerMode = $("#answerModeInput").value || config.answerMode;
  const answerInputMode = $("#answerInputModeInput").value || config.answerInputMode || "text";
  const youtubeStartAt = Number.parseInt($("#youtubeStartInput").value, 10) || 0;

  if (answerMode.includes("artist") && !artist) {
    setStatus($("#roundStatus"), "Renseigne l'artiste attendu.", "error");
    return;
  }
  if (answerMode.includes("title") && !title) {
    setStatus($("#roundStatus"), "Renseigne le titre attendu.", "error");
    return;
  }

  const now = Date.now();
  const roundNumber = Number(currentRound.roundNumber || 0) + 1;
  const payload = {
    active: true,
    status: "playing",
    roundId: `round-${now}`,
    roundNumber,
    startedAt: now,
    durationSec,
    answerMode,
    answerInputMode,
    playlistIndex: Number.isFinite(Number(options.playlistIndex)) ? Number(options.playlistIndex) : -1,
    playlistTrackId: options.playlistTrackId || "",
    revealedArtist: "",
    revealedTitle: "",
    youtubeVideoId: selectedVideo.videoId || "",
    youtubeUrl: selectedVideo.videoId ? youtubeWatchUrl(selectedVideo.videoId, youtubeStartAt) : "",
    youtubeTitle: selectedVideo.title || "",
    youtubeStartAt,
    playerVolume: readPlayerVolumeInput(),
    winnerAnswerId: "",
    winnerPlayerId: "",
    winnerTeamId: "",
    foundParts: {},
    lastAwardAnswerId: "",
    lastAwardAt: 0,
    reveal: false,
    endedAt: 0,
    endReason: "",
    answers: {}
  };

  try {
    if (selectedVideo.videoId) {
      await ensurePlayer(selectedVideo.videoId);
      if (playerReady) {
        ytPlayer.loadVideoById({ videoId: selectedVideo.videoId, startSeconds: youtubeStartAt });
        refreshPlayerAudio();
        ytPlayer.playVideo();
        window.setTimeout(() => refreshPlayerAudio(), 300);
      }
    }
      autoPausedRoundId = "";
    autoFinishRoundId = "";
    autoProcessingAnswerId = "";
    autoAdvanceRoundId = "";
    await update(ref(db, roomPath(roomId)), {
      currentRound: payload,
      "private/currentRoundSecret": {
        roundId: payload.roundId,
        roundNumber,
        artist,
        title,
        answerMode,
        answerInputMode,
        normalizedArtist: normalizeAnswer(artist),
        normalizedTitle: normalizeAnswer(title),
        createdAt: now
      }
    });
    setStatus($("#roundStatus"), "Manche lancée.", "success");
    return payload;
  } catch (error) {
    setStatus($("#roundStatus"), error.message || "Impossible de lancer la manche.", "error");
    return false;
  }
}

async function closeRound() {
  await update(ref(db, roomPath(roomId, "currentRound")), { active: false, status: "closed" });
  ytPlayer?.pauseVideo?.();
}

async function revealRound(reason = "manual") {
  const artist = secretRound.artist || $("#artistInput").value.trim();
  const title = secretRound.title || $("#titleInput").value.trim();
  const roundId = currentRound.roundId || activePlaylistRoundId;
  const playlistIndex = Number.isFinite(Number(currentRound.playlistIndex)) && Number(currentRound.playlistIndex) >= 0
    ? Number(currentRound.playlistIndex)
    : activePlaylistRoundIndex;
  await update(ref(db, roomPath(roomId, "currentRound")), {
    active: false,
    status: "revealed",
    reveal: true,
    revealedArtist: artist,
    revealedTitle: title,
    endedAt: Date.now(),
    endReason: reason
  });
  ytPlayer?.pauseVideo?.();
  if (playlistIndex >= 0) handlePlaylistAfterRoundEnd(playlistIndex, roundId).catch((error) => {
    setStatus($("#playlistStatus"), error.message || "Impossible de préparer le morceau suivant.", "error");
  });
}

async function resetRound() {
  const next = { ...defaultRound(), roundNumber: Number(currentRound.roundNumber || 0) };
  await set(ref(db, roomPath(roomId, "currentRound")), next);
  ytPlayer?.stopVideo?.();
}

async function resetScores() {
  const updates = {};
  teams.forEach((team) => updates[`teams/${team.id}/score`] = 0);
  players.forEach((player) => updates[`players/${player.id}/score`] = 0);
  if (Object.keys(updates).length) await update(ref(db, roomPath(roomId)), updates);
}

async function awardAnswerParts(answerId, parts, options = {}) {
  const answer = safeAnswers(currentRound).find((item) => item.id === answerId);
  if (!answer || currentRound.status !== "playing") return;
  if (!secretRound?.roundId || secretRound.roundId !== currentRound.roundId) return;

  const mode = currentRound.answerMode || config.answerMode;
  const missing = missingRequiredParts(currentRound, mode);
  const cleanParts = Array.from(new Set((parts || []).filter((part) => missing.includes(part))));
  if (!cleanParts.length) return;

  const now = Date.now();
  const artist = secretRound.artist || $("#artistInput").value.trim();
  const title = secretRound.title || $("#titleInput").value.trim();
  const updates = {};
  let totalPoints = Number(answer.pointsAwarded || 0);
  let newPoints = 0;
  const previousParts = Array.isArray(answer.partsAwarded) ? answer.partsAwarded : [];
  const nextParts = Array.from(new Set([...previousParts, ...cleanParts]));

  cleanParts.forEach((part) => {
    const points = partPoints(part, config, mode);
    newPoints += points;
    totalPoints += points;
    updates[`currentRound/foundParts/${part}`] = {
      answerId,
      playerId: answer.playerId,
      playerName: answer.playerName,
      teamId: answer.teamId,
      teamName: answer.teamName,
      text: answer.text,
      at: answer.at,
      points,
      auto: options.auto === true,
      awardedAt: now
    };
    updates[`currentRound/answers/${answerId}/${part === "artist" ? "matchedArtist" : "matchedTitle"}`] = true;
    updates[`currentRound/answers/${answerId}/${part === "artist" ? "pointsArtist" : "pointsTitle"}`] = points;
  });

  const bonus = cleanParts.includes("artist") && cleanParts.includes("title") ? Number(config.pointsThird || 0) : 0;
  if (bonus > 0) {
    newPoints += bonus;
    totalPoints += bonus;
    updates[`currentRound/answers/${answerId}/pointsBonus`] = bonus;
  }

  updates[`currentRound/answers/${answerId}/accepted`] = true;
  updates[`currentRound/answers/${answerId}/refused`] = false;
  updates[`currentRound/answers/${answerId}/pointsAwarded`] = totalPoints;
  updates[`currentRound/answers/${answerId}/partsAwarded`] = nextParts;
  updates[`currentRound/answers/${answerId}/validatedAt`] = now;
  updates[`currentRound/answers/${answerId}/autoAccepted`] = options.auto === true;
  updates["currentRound/lastAwardAnswerId"] = answerId;
  updates["currentRound/lastAwardAt"] = now;

  const simulatedRound = {
    ...currentRound,
    foundParts: {
      ...(currentRound.foundParts || {}),
      ...Object.fromEntries(cleanParts.map((part) => [part, { answerId }]))
    }
  };
  const complete = allRequiredPartsFound(simulatedRound, mode);

  if (complete) {
    updates["currentRound/winnerAnswerId"] = answerId;
    updates["currentRound/winnerPlayerId"] = answer.playerId;
    updates["currentRound/winnerTeamId"] = answer.teamId;
    updates["currentRound/active"] = false;
    updates["currentRound/status"] = "revealed";
    updates["currentRound/reveal"] = true;
    updates["currentRound/revealedArtist"] = artist;
    updates["currentRound/revealedTitle"] = title;
    updates["currentRound/endedAt"] = now;
    updates["currentRound/endReason"] = options.auto ? "auto_all_found" : "manual_all_found";
  }

  const team = teams.find((item) => item.id === answer.teamId);
  const player = players.find((item) => item.id === answer.playerId);
  updates[`teams/${answer.teamId}/score`] = Number(team?.score || 0) + newPoints;
  if (player?.id) updates[`players/${player.id}/score`] = Number(player.score || 0) + newPoints;

  await update(ref(db, roomPath(roomId)), updates);

  const labels = cleanParts.map(partLabel).join(" + ");
  if (complete) {
    ytPlayer?.pauseVideo?.();
    const playlistIndex = Number.isFinite(Number(currentRound.playlistIndex)) && Number(currentRound.playlistIndex) >= 0
      ? Number(currentRound.playlistIndex)
      : activePlaylistRoundIndex;
    if (playlistIndex >= 0) handlePlaylistAfterRoundEnd(playlistIndex, currentRound.roundId || activePlaylistRoundId).catch((error) => {
      setStatus($("#playlistStatus"), error.message || "Impossible de préparer le morceau suivant.", "error");
    });
    setStatus($("#roundStatus"), `${labels} trouvé${cleanParts.length > 1 ? "s" : ""} : manche terminée et réponse révélée.`, "success");
  } else {
    setStatus($("#roundStatus"), `${labels} trouvé${cleanParts.length > 1 ? "s" : ""} : +${newPoints} point${newPoints > 1 ? "s" : ""}. La manche continue.`, "success");
  }
}

async function awardDetectedParts(answerId, options = {}) {
  const answer = safeAnswers(currentRound).find((item) => item.id === answerId);
  if (!answer) return;
  const mode = currentRound.answerMode || config.answerMode;
  const detected = evaluateAnswerParts(answer.normalized || answer.text, secretRound, mode).parts;
  const missing = missingRequiredParts(currentRound, mode);
  const parts = detected.filter((part) => missing.includes(part));
  return awardAnswerParts(answerId, parts, options);
}


async function refuseAnswer(answerId) {
  const answer = safeAnswers(currentRound).find((item) => item.id === answerId);
  if (!answer || answer.accepted) return;
  await update(ref(db, roomPath(roomId, `currentRound/answers/${answerId}`)), {
    refused: true,
    accepted: false,
    pointsAwarded: 0,
    validatedAt: Date.now()
  });
}

function render() {
  $("#adminTitle").textContent = config.title;
  $("#adminSubtitle").textContent = `${config.subtitle} · ${config.durationSec}s · ${answerModeLabel(config.answerMode)}`;

  if (currentRound?.active && document.activeElement !== $("#durationInput")) $("#durationInput").value = currentRound.durationSec;
  else if (!$("#durationInput").value) $("#durationInput").value = config.durationSec;
  if (currentRound?.active && document.activeElement !== $("#answerModeInput")) $("#answerModeInput").value = currentRound.answerMode;
  else if (!$("#answerModeInput").value) $("#answerModeInput").value = config.answerMode;
  if (currentRound?.active && document.activeElement !== $("#answerInputModeInput")) $("#answerInputModeInput").value = currentRound.answerInputMode || config.answerInputMode;
  else if (!$("#answerInputModeInput").value) $("#answerInputModeInput").value = config.answerInputMode;
  applyPlayerVolume();

  const remaining = remainingSeconds(currentRound);
  const open = isRoundOpen(currentRound);
  const expired = currentRound?.active && remaining <= 0;
  $("#timerOrb").textContent = open || expired ? formatTimer(remaining) : "--";

  if (open) {
    $("#roundState").textContent = `Manche ${currentRound.roundNumber || ""} en cours`;
    $("#roundInfo").textContent = `Les joueurs peuvent répondre. ${foundPartsSummary(currentRound, currentRound.answerMode)}`;
  } else if (expired) {
    $("#roundState").textContent = "Temps écoulé";
    $("#roundInfo").textContent = "Temps écoulé : la réponse va être révélée automatiquement.";
    if (autoPausedRoundId !== currentRound.roundId) {
      autoPausedRoundId = currentRound.roundId;
      ytPlayer?.pauseVideo?.();
    }
  } else if (currentRound?.status === "revealed") {
    $("#roundState").textContent = currentRound.endReason === "auto_all_found" ? "Toutes les infos trouvées !" : "Réponse révélée";
    $("#roundInfo").textContent = expectedAnswerText({ ...currentRound, ...secretRound });
  } else if (currentRound?.roundId) {
    $("#roundState").textContent = "Manche fermée";
    $("#roundInfo").textContent = "Tu peux révéler maintenant ou préparer une nouvelle manche.";
  } else {
    $("#roundState").textContent = "En attente";
    $("#roundInfo").textContent = "Prépare une vidéo et une réponse. En mode Artiste + titre, chaque info est attribuée au plus rapide et la manche continue jusqu’à tout trouver.";
  }

  renderScoreboard();
  renderAnswers();
  renderPreparedTracks();
  maybeAutoFinishRound(open, expired);
}

function maybeAutoFinishRound(open, expired) {
  if (!currentRound?.roundId || currentRound.status !== "playing") return;
  if (!secretRound?.roundId || secretRound.roundId !== currentRound.roundId) return;

  if (open) {
    if ((currentRound.answerInputMode || config.answerInputMode) === "buzzer") return;
    if (autoProcessingAnswerId) return;
    const mode = currentRound.answerMode || config.answerMode;
    const missing = missingRequiredParts(currentRound, mode);
    if (!missing.length) return;

    const answer = safeAnswers(currentRound).find((item) => {
      if (item.refused) return false;
      const detected = evaluateAnswerParts(item.normalized || item.text, secretRound, mode).parts;
      return detected.some((part) => missing.includes(part));
    });

    if (!answer) return;
    autoProcessingAnswerId = answer.id;
    awardDetectedParts(answer.id, { auto: true }).catch((error) => {
      setStatus($("#roundStatus"), error.message || "Auto-validation impossible.", "error");
    }).finally(() => {
      autoProcessingAnswerId = "";
    });
    return;
  }

  if (expired && autoFinishRoundId !== currentRound.roundId) {
    autoFinishRoundId = currentRound.roundId;
    revealRound("timeout").catch((error) => {
      autoFinishRoundId = "";
      setStatus($("#roundStatus"), error.message || "Révélation automatique impossible.", "error");
    });
  }
}


function renderScoreboard() {
  const list = $("#scoreboardList");
  list.innerHTML = "";
  teams.forEach((team, index) => {
    const row = document.createElement("div");
    row.className = "scoreboard-row";
    row.style.setProperty("--team", team.color);
    const rank = document.createElement("strong");
    rank.textContent = `#${index + 1}`;
    const name = document.createElement("span");
    name.textContent = team.name;
    const score = document.createElement("b");
    score.textContent = `${team.score} pt${team.score > 1 ? "s" : ""}`;
    row.append(rank, name, score);
    list.appendChild(row);
  });
}

function renderAnswers() {
  const answers = safeAnswers(currentRound);
  const accepted = acceptedAnswers(currentRound);
  const mode = currentRound.answerMode || config.answerMode;
  const missing = missingRequiredParts(currentRound, mode);
  $("#answersSummary").textContent = `${answers.length} réponse${answers.length > 1 ? "s" : ""} · ${accepted.length} avec point${accepted.length > 1 ? "s" : ""} · ${foundPartsSummary(currentRound, mode)}`;
  const list = $("#answersList");
  list.innerHTML = "";

  if (!answers.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "Aucune réponse pour cette manche.";
    list.appendChild(empty);
    return;
  }

  answers.forEach((answer, index) => {
    const team = teams.find((item) => item.id === answer.teamId);
    const detected = secretRound?.roundId === currentRound.roundId
      ? evaluateAnswerParts(answer.normalized || answer.text, secretRound, mode).parts
      : [];
    const awardable = detected.filter((part) => missing.includes(part));

    const card = document.createElement("article");
    card.className = "answer-card";
    if (answer.accepted) card.classList.add("accepted");
    if (answer.refused) card.classList.add("refused");
    card.style.setProperty("--team", team?.color || "#ffd166");

    const top = document.createElement("div");
    top.className = "answer-top";
    const pos = document.createElement("strong");
    pos.textContent = `#${index + 1}`;
    const who = document.createElement("span");
    who.textContent = `${answer.playerName} · ${answer.teamName}`;
    const when = document.createElement("small");
    const delta = currentRound.startedAt ? Math.max(0, ((answer.at - currentRound.startedAt) / 1000)).toFixed(1) : "0.0";
    when.textContent = `+${delta}s`;
    top.append(pos, who, when);

    const text = document.createElement("p");
    text.className = "answer-text";
    text.textContent = answer.type === "buzz" ? "🔔 BUZZER — réponse orale à valider par l’arbitre" : answer.text;

    const parts = document.createElement("p");
    parts.className = "muted small-note";
    const won = [];
    if (answer.matchedArtist) won.push(`✅ Artiste +${answer.pointsArtist || 0}`);
    if (answer.matchedTitle) won.push(`✅ Titre +${answer.pointsTitle || 0}`);
    if (answer.pointsBonus) won.push(`⭐ Bonus +${answer.pointsBonus}`);
    const detectedLabels = answer.type === "buzz" ? [] : detected.map((part) => `détecté : ${partLabel(part).toLowerCase()}`);
    parts.textContent = won.length ? won.join(" · ") : answer.type === "buzz" ? "Buzzer : l’arbitre valide ou refuse après la réponse orale." : detectedLabels.length ? detectedLabels.join(" · ") : "Aucun élément reconnu automatiquement.";

    const bottom = document.createElement("div");
    bottom.className = "tiny-actions";

    ["artist", "title"].forEach((part) => {
      if (!missing.includes(part)) return;
      if (!mode.includes(part)) return;
      const btn = document.createElement("button");
      btn.type = "button";
      const pts = partPoints(part, config, mode);
      btn.textContent = `Attribuer ${partLabel(part).toLowerCase()} +${pts}`;
      btn.disabled = currentRound.status !== "playing" || answer.refused;
      btn.addEventListener("click", () => awardAnswerParts(answer.id, [part], { auto: false }));
      bottom.appendChild(btn);
    });

    const autoBtn = document.createElement("button");
    autoBtn.type = "button";
    const buzzParts = missing.filter((part) => mode.includes(part));
    const manualParts = answer.type === "buzz" ? buzzParts : awardable;
    autoBtn.textContent = answer.type === "buzz" ? `Valider réponse orale : ${buzzParts.map(partLabel).join(" + ")}` : awardable.length ? `Attribuer détecté : ${awardable.map(partLabel).join(" + ")}` : "Rien à attribuer";
    autoBtn.disabled = !manualParts.length || currentRound.status !== "playing" || answer.refused;
    autoBtn.addEventListener("click", () => awardAnswerParts(answer.id, manualParts, { auto: false }));

    const refuse = document.createElement("button");
    refuse.type = "button";
    refuse.textContent = answer.refused ? "Refusée" : "Refuser";
    refuse.disabled = answer.accepted || answer.refused || currentRound.status !== "playing";
    refuse.addEventListener("click", () => refuseAnswer(answer.id));

    bottom.prepend(autoBtn);
    bottom.append(refuse);
    card.append(top, text, parts, bottom);
    list.appendChild(card);
  });
}


window.addEventListener("beforeunload", () => {
  if (timerId) clearInterval(timerId);
});
