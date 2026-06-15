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
  nextPoints,
  normalizeAnswer,
  parseYouTubeTitleGuess,
  answerMatchesExpected,
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
let autoCheckAnswerId = "";

const apiKeyStorageKey = "blindMasterYoutubeApiKey";

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

function openAdmin() {
  $("#authPanel").hidden = true;
  $("#adminPanel").hidden = false;
  $("#settingsLink").href = publicUrl("settings.html", roomId);
  $("#screenLink").href = publicUrl("screen.html", roomId);
  $("#voteLink").href = publicUrl("vote.html", roomId);
  $("#youtubeApiKeyInput").value = localStorage.getItem(apiKeyStorageKey) || "";

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

  $("#startRoundBtn").addEventListener("click", startRound);
  $("#closeRoundBtn").addEventListener("click", closeRound);
  $("#revealRoundBtn").addEventListener("click", () => revealRound("manual"));
  $("#resetRoundBtn").addEventListener("click", resetRound);
  $("#resetScoresBtn").addEventListener("click", resetScores);
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
}

async function startRound() {
  const artist = $("#artistInput").value.trim();
  const title = $("#titleInput").value.trim();
  const durationSec = clampDuration($("#durationInput").value || config.durationSec);
  const answerMode = $("#answerModeInput").value || config.answerMode;
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
    revealedArtist: "",
    revealedTitle: "",
    youtubeVideoId: selectedVideo.videoId || "",
    youtubeUrl: selectedVideo.videoId ? youtubeWatchUrl(selectedVideo.videoId, youtubeStartAt) : "",
    youtubeTitle: selectedVideo.title || "",
    youtubeStartAt,
    winnerAnswerId: "",
    winnerPlayerId: "",
    winnerTeamId: "",
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
        ytPlayer.playVideo();
      }
    }
    autoPausedRoundId = "";
    autoFinishRoundId = "";
    autoCheckAnswerId = "";
    await update(ref(db, roomPath(roomId)), {
      currentRound: payload,
      "private/currentRoundSecret": {
        roundId: payload.roundId,
        roundNumber,
        artist,
        title,
        answerMode,
        normalizedArtist: normalizeAnswer(artist),
        normalizedTitle: normalizeAnswer(title),
        createdAt: now
      }
    });
    setStatus($("#roundStatus"), "Manche lancée.", "success");
  } catch (error) {
    setStatus($("#roundStatus"), error.message || "Impossible de lancer la manche.", "error");
  }
}

async function closeRound() {
  await update(ref(db, roomPath(roomId, "currentRound")), { active: false, status: "closed" });
  ytPlayer?.pauseVideo?.();
}

async function revealRound(reason = "manual") {
  const artist = secretRound.artist || $("#artistInput").value.trim();
  const title = secretRound.title || $("#titleInput").value.trim();
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

async function acceptAnswer(answerId, options = {}) {
  const answer = safeAnswers(currentRound).find((item) => item.id === answerId);
  if (!answer || answer.accepted || currentRound.winnerAnswerId) return;

  const now = Date.now();
  const points = nextPoints(config, currentRound);
  const artist = secretRound.artist || $("#artistInput").value.trim();
  const title = secretRound.title || $("#titleInput").value.trim();
  const updates = {};

  updates[`currentRound/answers/${answerId}/accepted`] = true;
  updates[`currentRound/answers/${answerId}/refused`] = false;
  updates[`currentRound/answers/${answerId}/pointsAwarded`] = points;
  updates[`currentRound/answers/${answerId}/validatedAt`] = now;
  updates[`currentRound/answers/${answerId}/autoAccepted`] = options.auto === true;

  updates["currentRound/winnerAnswerId"] = answerId;
  updates["currentRound/winnerPlayerId"] = answer.playerId;
  updates["currentRound/winnerTeamId"] = answer.teamId;
  updates["currentRound/active"] = false;
  updates["currentRound/status"] = "revealed";
  updates["currentRound/reveal"] = true;
  updates["currentRound/revealedArtist"] = artist;
  updates["currentRound/revealedTitle"] = title;
  updates["currentRound/endedAt"] = now;
  updates["currentRound/endReason"] = options.auto ? "auto_correct" : "manual_correct";

  const team = teams.find((item) => item.id === answer.teamId);
  const player = players.find((item) => item.id === answer.playerId);
  updates[`teams/${answer.teamId}/score`] = Number(team?.score || 0) + points;
  if (player?.id) updates[`players/${player.id}/score`] = Number(player.score || 0) + points;

  await update(ref(db, roomPath(roomId)), updates);
  ytPlayer?.pauseVideo?.();
  setStatus($("#roundStatus"), options.auto ? "Bonne réponse détectée : manche arrêtée et réponse révélée." : "Réponse acceptée : manche arrêtée et réponse révélée.", "success");
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

  if (document.activeElement !== $("#durationInput")) $("#durationInput").value = currentRound?.active ? currentRound.durationSec : config.durationSec;
  if (document.activeElement !== $("#answerModeInput")) $("#answerModeInput").value = currentRound?.active ? currentRound.answerMode : config.answerMode;

  const remaining = remainingSeconds(currentRound);
  const open = isRoundOpen(currentRound);
  const expired = currentRound?.active && remaining <= 0;
  $("#timerOrb").textContent = open || expired ? formatTimer(remaining) : "--";

  if (open) {
    $("#roundState").textContent = `Manche ${currentRound.roundNumber || ""} en cours`;
    $("#roundInfo").textContent = `Les joueurs peuvent répondre. Réponse attendue : ${answerModeLabel(currentRound.answerMode)}.`;
  } else if (expired) {
    $("#roundState").textContent = "Temps écoulé";
    $("#roundInfo").textContent = "Temps écoulé : la réponse va être révélée automatiquement.";
    if (autoPausedRoundId !== currentRound.roundId) {
      autoPausedRoundId = currentRound.roundId;
      ytPlayer?.pauseVideo?.();
    }
  } else if (currentRound?.status === "revealed") {
    $("#roundState").textContent = currentRound.endReason === "auto_correct" ? "Bonne réponse !" : "Réponse révélée";
    $("#roundInfo").textContent = expectedAnswerText({ ...currentRound, ...secretRound });
  } else if (currentRound?.roundId) {
    $("#roundState").textContent = "Manche fermée";
    $("#roundInfo").textContent = "Tu peux révéler maintenant ou préparer une nouvelle manche.";
  } else {
    $("#roundState").textContent = "En attente";
    $("#roundInfo").textContent = "Prépare une vidéo et une réponse. L’app révèle automatiquement au premier bon répondant ou à la fin du chrono.";
  }

  renderScoreboard();
  renderAnswers();
  maybeAutoFinishRound(open, expired);
}

function maybeAutoFinishRound(open, expired) {
  if (!currentRound?.roundId || currentRound.status !== "playing" || currentRound.winnerAnswerId) return;
  if (!secretRound?.roundId || secretRound.roundId !== currentRound.roundId) return;

  if (open) {
    const answer = safeAnswers(currentRound).find((item) => !item.accepted && !item.refused && answerMatchesExpected(item.normalized || item.text, secretRound, currentRound.answerMode));
    if (!answer || autoCheckAnswerId === answer.id) return;
    autoCheckAnswerId = answer.id;
    acceptAnswer(answer.id, { auto: true }).catch((error) => {
      autoCheckAnswerId = "";
      setStatus($("#roundStatus"), error.message || "Auto-validation impossible.", "error");
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
  $("#answersSummary").textContent = `${answers.length} réponse${answers.length > 1 ? "s" : ""} · ${accepted.length} acceptée${accepted.length > 1 ? "s" : ""}`;
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
    text.textContent = answer.text;

    const bottom = document.createElement("div");
    bottom.className = "tiny-actions";
    const accept = document.createElement("button");
    accept.type = "button";
    accept.textContent = answer.accepted ? `Acceptée +${answer.pointsAwarded}` : `Accepter +${nextPoints(config, currentRound)} et révéler`;
    accept.disabled = answer.accepted || answer.refused;
    accept.addEventListener("click", () => acceptAnswer(answer.id));

    const refuse = document.createElement("button");
    refuse.type = "button";
    refuse.textContent = answer.refused ? "Refusée" : "Refuser";
    refuse.disabled = answer.accepted || answer.refused;
    refuse.addEventListener("click", () => refuseAnswer(answer.id));

    bottom.append(accept, refuse);
    card.append(top, text, bottom);
    list.appendChild(card);
  });
}

window.addEventListener("beforeunload", () => {
  if (timerId) clearInterval(timerId);
});
