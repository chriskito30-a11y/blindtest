import { db, ref, set, update, onValue, get } from "./firebase-config.js";
import {
  $,
  getRoomIdFromUrl,
  getTeamIdFromUrl,
  roomPath,
  safeConfig,
  safeTeams,
  safeAnswers,
  remainingSeconds,
  isRoundOpen,
  formatTimer,
  getDeviceId,
  getSavedPlayer,
  savePlayer,
  normalizeAnswer,
  createTeam,
  answerModeLabel,
  setStatus,
  renderOption
} from "./core.js";

const roomId = getRoomIdFromUrl();
const lockedTeamId = getTeamIdFromUrl();
const playerId = getDeviceId();

let config = safeConfig();
let teams = [];
let currentRound = {};
let player = getSavedPlayer(roomId);
let tick = null;
let seenRoundId = "";

if (!roomId) {
  $("#missingRoom").hidden = false;
} else {
  boot();
}

function boot() {
  $("#joinPanel").hidden = false;
  bindJoin();

  onValue(ref(db, roomPath(roomId, "config")), (snap) => {
    config = safeConfig(snap.val() || {});
    render();
  });
  onValue(ref(db, roomPath(roomId, "teams")), (snap) => {
    teams = safeTeams(snap.val() || {});
    renderTeamSelect();
    render();
  });
  onValue(ref(db, roomPath(roomId, "currentRound")), (snap) => {
    currentRound = snap.val() || {};
    if (currentRound.roundId && currentRound.roundId !== seenRoundId) {
      seenRoundId = currentRound.roundId;
      $("#answerInput").value = "";
    }
    render();
  });

  tick = setInterval(() => {
    if (player?.id) update(ref(db, roomPath(roomId, `players/${player.id}`)), { lastSeenAt: Date.now() });
    render();
  }, 1000);
}

function bindJoin() {
  $("#joinForm").addEventListener("submit", joinPlayer);
  $("#createTeamBtn").addEventListener("click", createPlayerTeam);
  $("#changePlayerBtn").addEventListener("click", () => {
    player = null;
    savePlayer(roomId, null);
    $("#playerPanel").hidden = true;
    $("#joinPanel").hidden = false;
    render();
  });
  $("#answerForm").addEventListener("submit", sendAnswer);

  if (player?.name) {
    $("#playerNameInput").value = player.name;
  }
}

function renderTeamSelect() {
  const select = $("#teamSelect");
  if (!select) return;
  const current = select.value || player?.teamId || lockedTeamId;
  select.innerHTML = "";
  teams.forEach((team) => renderOption(select, team.id, team.name));
  if (current && teams.some((team) => team.id === current)) select.value = current;

  const locked = lockedTeamId && teams.find((team) => team.id === lockedTeamId);
  $("#teamSelectLabel").hidden = Boolean(locked);
  $("#lockedTeamBox").hidden = !locked;
  if (locked) $("#lockedTeamBox").textContent = `Tu rejoins : ${locked.name}`;
  $("#createTeamBox").hidden = !config.allowTeamCreation;
}

async function createPlayerTeam() {
  const name = $("#newTeamNameInput").value.trim();
  setStatus($("#joinStatus"), "Création de l'équipe...");
  try {
    const id = await createTeam(roomId, name);
    $("#newTeamNameInput").value = "";
    $("#teamSelect").value = id;
    setStatus($("#joinStatus"), "Équipe créée. Tu peux rejoindre la partie.", "success");
  } catch (error) {
    setStatus($("#joinStatus"), error.message || "Impossible de créer l'équipe.", "error");
  }
}

async function joinPlayer(event) {
  event.preventDefault();
  const name = $("#playerNameInput").value.trim().slice(0, 32);
  const locked = lockedTeamId && teams.find((team) => team.id === lockedTeamId);
  const teamId = locked ? lockedTeamId : $("#teamSelect").value;
  const team = teams.find((item) => item.id === teamId);
  if (!name) {
    setStatus($("#joinStatus"), "Entre ton prénom ou pseudo.", "error");
    return;
  }
  if (!team) {
    setStatus($("#joinStatus"), "Choisis une équipe.", "error");
    return;
  }

  const existing = await get(ref(db, roomPath(roomId, `players/${playerId}`)));
  const existingScore = Number(existing.val()?.score || 0);
  const payload = {
    id: playerId,
    name,
    teamId,
    teamName: team.name,
    score: existingScore,
    joinedAt: existing.val()?.joinedAt || Date.now(),
    lastSeenAt: Date.now()
  };
  await set(ref(db, roomPath(roomId, `players/${playerId}`)), payload);
  player = payload;
  savePlayer(roomId, player);
  $("#joinPanel").hidden = true;
  $("#playerPanel").hidden = false;
  render();
}

async function sendAnswer(event) {
  event.preventDefault();
  if (!player?.id || !isRoundOpen(currentRound)) return;
  const text = $("#answerInput").value.trim().slice(0, 120);
  if (!text) return;

  const answers = safeAnswers(currentRound).filter((answer) => answer.playerId === player.id);
  if (answers.length >= config.maxAnswersPerPlayer) {
    render();
    return;
  }
  const team = teams.find((item) => item.id === player.teamId);
  const answerId = `${Date.now()}-${player.id.slice(0, 10)}`;
  await set(ref(db, roomPath(roomId, `currentRound/answers/${answerId}`)), {
    playerId: player.id,
    playerName: player.name,
    teamId: player.teamId,
    teamName: team?.name || player.teamName || "Équipe",
    text,
    normalized: normalizeAnswer(text),
    at: Date.now(),
    accepted: false,
    refused: false,
    pointsAwarded: 0
  });
  $("#answerInput").value = "";
  render();
}

function render() {
  $("#joinTitle").textContent = config.title;
  $("#joinSubtitle").textContent = config.subtitle;

  if (player?.id && $("#playerPanel").hidden && teams.length) {
    const teamExists = teams.some((team) => team.id === player.teamId);
    if (teamExists) {
      $("#joinPanel").hidden = true;
      $("#playerPanel").hidden = false;
    }
  }

  if (!player?.id) return;
  const team = teams.find((item) => item.id === player.teamId);
  $("#playerGameTitle").textContent = config.title;
  $("#playerTeamName").textContent = team?.name || player.teamName || "Équipe";
  $("#playerTeamName").style.color = team?.color || "";
  $("#playerNameLabel").textContent = `${player.name} · ${answerModeLabel(currentRound.answerMode || config.answerMode)}`;
  $("#answerLabel").textContent = `Ta réponse (${answerModeLabel(currentRound.answerMode || config.answerMode)})`;

  const remaining = remainingSeconds(currentRound);
  const open = isRoundOpen(currentRound);
  const answers = safeAnswers(currentRound).filter((answer) => answer.playerId === player.id);
  const attemptsLeft = Math.max(0, config.maxAnswersPerPlayer - answers.length);
  const canAnswer = open && attemptsLeft > 0;

  $("#answerInput").disabled = !canAnswer;
  $("#sendAnswerBtn").disabled = !canAnswer;

  if (open) {
    $("#voteTimer").textContent = formatTimer(remaining);
    $("#voteMessage").textContent = attemptsLeft > 0 ? `Réponds vite ! Tentative restante : ${attemptsLeft}` : "Réponse envoyée. Attends la validation de l’arbitre.";
  } else if (currentRound?.status === "revealed" && currentRound?.reveal) {
    $("#voteTimer").textContent = "Révélé";
    const expected = [currentRound.revealedArtist, currentRound.revealedTitle].filter(Boolean).join(" — ");
    $("#voteMessage").textContent = expected ? `Réponse : ${expected}` : "La réponse a été révélée.";
  } else if (currentRound?.active && remaining <= 0) {
    $("#voteTimer").textContent = "Terminé";
    $("#voteMessage").textContent = "Temps écoulé. Attends la validation de l’arbitre.";
  } else {
    $("#voteTimer").textContent = "En attente";
    $("#voteMessage").textContent = "Attends que l’arbitre lance la manche.";
  }

  renderHistory(answers);
}

function renderHistory(answers) {
  const box = $("#answerHistory");
  box.innerHTML = "";
  if (!answers.length) return;
  answers.forEach((answer) => {
    const item = document.createElement("div");
    item.className = "answer-history-item";
    if (answer.accepted) item.classList.add("accepted");
    if (answer.refused) item.classList.add("refused");
    item.textContent = answer.accepted ? `✅ ${answer.text} (+${answer.pointsAwarded})` : answer.refused ? `❌ ${answer.text}` : `Envoyé : ${answer.text}`;
    box.appendChild(item);
  });
}

window.addEventListener("beforeunload", () => {
  if (tick) clearInterval(tick);
});
