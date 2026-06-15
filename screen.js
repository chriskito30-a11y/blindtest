import { db, ref, onValue } from "./firebase-config.js";
import {
  $,
  getRoomIdFromUrl,
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
  qrCodeUrl,
  expectedAnswerText,
  answerModeLabel,
  safeFoundParts,
  requiredParts,
  partLabel,
  foundPartsSummary
} from "./core.js";

const roomId = getRoomIdFromUrl();
let config = safeConfig();
let teams = [];
let players = [];
let currentRound = {};
let previousAwardKey = "";
let tick = null;

if (!roomId) {
  $("#missingRoom").hidden = false;
} else {
  $("#screenContent").hidden = false;
  boot();
}

function boot() {
  $("#joinQr").src = qrCodeUrl(publicUrl("vote.html", roomId), 360);
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
    currentRound = snap.val() || {};
    const awardKey = `${currentRound.lastAwardAnswerId || currentRound.winnerAnswerId || ""}:${currentRound.lastAwardAt || ""}`;
    if (awardKey && awardKey !== previousAwardKey) {
      previousAwardKey = awardKey;
      document.body.classList.remove("winner-pop");
      void document.body.offsetWidth;
      document.body.classList.add("winner-pop");
    }
    render();
  });
  tick = setInterval(render, 250);
}

function render() {
  const remaining = remainingSeconds(currentRound);
  const open = isRoundOpen(currentRound);
  const expired = currentRound?.active && remaining <= 0;
  const duration = Number(currentRound?.durationSec || config.durationSec || 20);
  const progress = open || expired ? Math.max(0, Math.min(100, (remaining / duration) * 100)) : 0;
  const answers = safeAnswers(currentRound);
  const accepted = acceptedAnswers(currentRound);
  const found = safeFoundParts(currentRound);
  const foundCount = Object.keys(found).length;
  const neededCount = requiredParts(currentRound.answerMode || config.answerMode).length;

  $("#screenTitle").textContent = config.title;
  $("#screenSubtitle").textContent = config.subtitle;
  $("#progressBar").style.width = `${progress}%`;
  $("#playerCount").textContent = `${players.length} joueur${players.length > 1 ? "s" : ""} connecté${players.length > 1 ? "s" : ""}`;

  if (open) {
    $("#screenStatus").textContent = `Manche ${currentRound.roundNumber || ""} en cours`;
    $("#screenRoundInfo").textContent = `${answerModeLabel(currentRound.answerMode || config.answerMode)} · ${foundCount}/${neededCount} info${neededCount > 1 ? "s" : ""} trouvée${foundCount > 1 ? "s" : ""} · ${answers.length} réponse${answers.length > 1 ? "s" : ""}`;
    $("#screenTimer").textContent = formatTimer(remaining);
    document.body.classList.add("round-live");
    document.body.classList.remove("round-ended");
  } else if (expired) {
    $("#screenStatus").textContent = "Temps écoulé";
    $("#screenRoundInfo").textContent = "Révélation automatique en cours.";
    $("#screenTimer").textContent = "FIN";
    document.body.classList.remove("round-live");
    document.body.classList.add("round-ended");
  } else if (currentRound?.status === "revealed") {
    $("#screenStatus").textContent = currentRound?.winnerAnswerId ? "Toutes les infos trouvées !" : "Réponse révélée";
    $("#screenRoundInfo").textContent = currentRound?.winnerAnswerId ? foundPartsSummary(currentRound, currentRound.answerMode || config.answerMode) : "Préparez-vous pour la manche suivante.";
    $("#screenTimer").textContent = "♪";
    document.body.classList.remove("round-live");
    document.body.classList.add("round-ended");
  } else if (currentRound?.roundId) {
    $("#screenStatus").textContent = "Manche fermée";
    $("#screenRoundInfo").textContent = "En attente de la révélation ou de la prochaine manche.";
    $("#screenTimer").textContent = "--";
  } else {
    $("#screenStatus").textContent = "En attente";
    $("#screenRoundInfo").textContent = "Scanne le QR code pour rejoindre la partie.";
    $("#screenTimer").textContent = "--";
  }

  renderFoundParts(found);
  renderReveal();
  renderScoreboard();
}

function renderFoundParts(found) {
  const panel = $("#winnerPanel");
  const parts = requiredParts(currentRound.answerMode || config.answerMode)
    .map((part) => ({ part, item: found[part] }))
    .filter((entry) => entry.item);

  if (!parts.length) {
    panel.hidden = true;
    return;
  }

  panel.hidden = false;
  const eyebrow = panel.querySelector(".eyebrow");
  if (eyebrow) eyebrow.textContent = "Infos trouvées";
  $("#winnerName").textContent = parts.map(({ part, item }) => `${partLabel(part)} : ${item.playerName}`).join(" · ");
  $("#winnerTeam").textContent = parts.map(({ part, item }) => `${item.teamName} · +${item.points} ${partLabel(part).toLowerCase()}`).join(" | ");
}


function renderReveal() {
  const panel = $("#answerRevealPanel");
  const canReveal = currentRound?.status === "revealed" && currentRound?.reveal && config.revealAnswerOnScreen;
  if (!canReveal) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  $("#revealedAnswer").textContent = expectedAnswerText(currentRound);
}

function renderScoreboard() {
  const board = $("#screenScoreboard");
  board.innerHTML = "";
  board.classList.toggle("many-teams", teams.length > 6);
  teams.forEach((team, index) => {
    const count = players.filter((player) => player.teamId === team.id).length;
    const card = document.createElement("article");
    card.className = "screen-team-card";
    card.style.setProperty("--team", team.color);
    const rank = document.createElement("div");
    rank.className = "screen-rank";
    rank.textContent = `#${index + 1}`;
    const name = document.createElement("h2");
    name.textContent = team.name;
    const score = document.createElement("div");
    score.className = "screen-team-score";
    score.textContent = team.score;
    const meta = document.createElement("p");
    meta.className = "muted";
    meta.textContent = `${count} joueur${count > 1 ? "s" : ""}`;
    card.append(rank, name, score, meta);
    board.appendChild(card);
  });
}

window.addEventListener("beforeunload", () => {
  if (tick) clearInterval(tick);
});
