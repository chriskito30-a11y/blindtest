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
  answerModeLabel
} from "./core.js";

const roomId = getRoomIdFromUrl();
let config = safeConfig();
let teams = [];
let players = [];
let currentRound = {};
let previousWinnerId = "";
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
    if (currentRound.winnerAnswerId && currentRound.winnerAnswerId !== previousWinnerId) {
      previousWinnerId = currentRound.winnerAnswerId;
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
  const winner = currentRound?.winnerAnswerId ? answers.find((answer) => answer.id === currentRound.winnerAnswerId) : accepted[0];

  $("#screenTitle").textContent = config.title;
  $("#screenSubtitle").textContent = config.subtitle;
  $("#progressBar").style.width = `${progress}%`;
  $("#playerCount").textContent = `${players.length} joueur${players.length > 1 ? "s" : ""} connecté${players.length > 1 ? "s" : ""}`;

  if (open) {
    $("#screenStatus").textContent = `Manche ${currentRound.roundNumber || ""} en cours`;
    $("#screenRoundInfo").textContent = `${answerModeLabel(currentRound.answerMode || config.answerMode)} · ${answers.length} réponse${answers.length > 1 ? "s" : ""} reçue${answers.length > 1 ? "s" : ""}`;
    $("#screenTimer").textContent = formatTimer(remaining);
    document.body.classList.add("round-live");
    document.body.classList.remove("round-ended");
  } else if (expired) {
    $("#screenStatus").textContent = "Temps écoulé";
    $("#screenRoundInfo").textContent = "L’arbitre valide la première bonne réponse.";
    $("#screenTimer").textContent = "FIN";
    document.body.classList.remove("round-live");
    document.body.classList.add("round-ended");
  } else if (currentRound?.status === "revealed") {
    $("#screenStatus").textContent = "Réponse révélée";
    $("#screenRoundInfo").textContent = "Préparez-vous pour la manche suivante.";
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

  renderWinner(winner);
  renderReveal();
  renderScoreboard();
}

function renderWinner(winner) {
  const panel = $("#winnerPanel");
  if (!winner) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  $("#winnerName").textContent = winner.playerName;
  $("#winnerTeam").textContent = `${winner.teamName} · +${winner.pointsAwarded || 0} point${Number(winner.pointsAwarded || 0) > 1 ? "s" : ""}`;
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
