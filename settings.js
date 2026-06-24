import { db, ref, get, update, onValue } from "./firebase-config.js";
import {
  $,
  $all,
  getRoomIdFromUrl,
  getRememberedPassword,
  rememberPassword,
  verifyRoomPassword,
  roomPath,
  safeConfig,
  safeTeams,
  safePlayers,
  clampDuration,
  clampAttempts,
  clampPoints,
  createTeam,
  deleteTeam,
  publicUrl,
  qrCodeUrl,
  copyToClipboard,
  setStatus,
  friendlyErrorMessage,
  normalizeTeamId,
  TEAM_COLORS
} from "./core.js";

const roomId = getRoomIdFromUrl();
let config = safeConfig();
let teams = [];
let players = [];

const missingRoom = $("#missingRoom");
const authPanel = $("#authPanel");
const settingsPanel = $("#settingsPanel");
const authForm = $("#authForm");
const authPassword = $("#authPassword");
const authError = $("#authError");
const saveStatus = $("#saveStatus");
const teamStatus = $("#teamStatus");

const fields = {
  title: $("#titleInput"),
  subtitle: $("#subtitleInput"),
  durationSec: $("#durationInput"),
  answerMode: $("#answerModeInput"),
  answerInputMode: $("#answerInputModeInput"),
  youtubePlayerVolume: $("#youtubePlayerVolumeInput"),
  maxAnswersPerPlayer: $("#maxAnswersInput"),
  pointsFirst: $("#pointsFirstInput"),
  pointsSecond: $("#pointsSecondInput"),
  pointsThird: $("#pointsThirdInput"),
  allowTeamCreation: $("#allowTeamCreationInput"),
  revealAnswerOnScreen: $("#revealAnswerInput")
};

if (!roomId) {
  missingRoom.hidden = false;
} else {
  $("#authRoomName").textContent = roomId;
  bootAuth();
}

async function bootAuth() {
  const remembered = getRememberedPassword(roomId);
  if (remembered && await verifyRoomPassword(roomId, remembered)) {
    openSettings();
    return;
  }
  authPanel.hidden = false;
  authPassword.focus();
}

authForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  setStatus(authError, "");
  const password = authPassword.value;
  const ok = await verifyRoomPassword(roomId, password);
  if (!ok) {
    setStatus(authError, "Mot de passe incorrect.", "error");
    return;
  }
  rememberPassword(roomId, password);
  openSettings();
});

async function openSettings() {
  authPanel.hidden = true;
  settingsPanel.hidden = false;
  $("#pageTitle").textContent = `Configuration · ${roomId}`;
  $("#openAdminLink").href = publicUrl("admin.html", roomId);
  $("#openScreenLink").href = publicUrl("screen.html", roomId);
  fillLinks();
  bindCopyButtons();

  const snap = await get(ref(db, roomPath(roomId, "config")));
  config = safeConfig(snap.val() || {});
  hydrateFields();

  onValue(ref(db, roomPath(roomId, "config")), (cfgSnap) => {
    config = safeConfig(cfgSnap.val() || {});
    hydrateFields(false);
  });

  onValue(ref(db, roomPath(roomId, "teams")), (teamsSnap) => {
    teams = safeTeams(teamsSnap.val() || {});
    renderTeams();
  });

  onValue(ref(db, roomPath(roomId, "players")), (playersSnap) => {
    players = safePlayers(playersSnap.val() || {});
    renderTeams();
  });
}

function hydrateFields(force = true) {
  const active = document.activeElement;
  Object.entries(fields).forEach(([key, field]) => {
    if (!field) return;
    if (!force && active === field) return;
    if (field.type === "checkbox") field.checked = Boolean(config[key]);
    else field.value = config[key] ?? "";
  });
}

function fillLinks() {
  const links = {
    player: { url: publicUrl("vote.html", roomId), input: "playerLink", open: "playerOpenLink", qr: "playerQr" },
    screen: { url: publicUrl("screen.html", roomId), input: "screenLink", open: "screenOpenLink", qr: "screenQr" },
    admin: { url: publicUrl("admin.html", roomId), input: "adminLinkInput", open: "adminOpenLink" }
  };

  Object.values(links).forEach((item) => {
    const input = $(`#${item.input}`);
    const open = $(`#${item.open}`);
    const qr = item.qr ? $(`#${item.qr}`) : null;
    if (input) input.value = item.url;
    if (open) open.href = item.url;
    if (qr) qr.src = qrCodeUrl(item.url, 240);
  });
}

function bindCopyButtons() {
  $all("[data-copy]").forEach((button) => {
    button.addEventListener("click", async () => {
      const input = $(`#${button.dataset.copy}`);
      if (!input) return;
      await copyToClipboard(input.value);
      const old = button.textContent;
      button.textContent = "Copié";
      setTimeout(() => button.textContent = old, 1200);
    });
  });
}

$("#settingsForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  setStatus(saveStatus, "Enregistrement...");
  const payload = {
    title: fields.title.value.trim() || "BlindTest Master",
    subtitle: fields.subtitle.value.trim() || "Blind test live · Fais Ton Show",
    durationSec: clampDuration(fields.durationSec.value),
    answerMode: fields.answerMode.value,
    answerInputMode: fields.answerInputMode.value,
    youtubePlayerVolume: Math.min(100, Math.max(0, Number.parseInt(fields.youtubePlayerVolume.value, 10) || 70)),
    maxAnswersPerPlayer: clampAttempts(fields.maxAnswersPerPlayer.value),
    pointsFirst: clampPoints(fields.pointsFirst.value, 5),
    pointsSecond: clampPoints(fields.pointsSecond.value, 5),
    pointsThird: clampPoints(fields.pointsThird.value, 0),
    allowTeamCreation: fields.allowTeamCreation.checked,
    revealAnswerOnScreen: fields.revealAnswerOnScreen.checked,
    updatedAt: Date.now()
  };

  try {
    await update(ref(db, roomPath(roomId, "config")), payload);
    await update(ref(db, roomPath(roomId, "currentRound")), {
      durationSec: payload.durationSec,
      answerMode: payload.answerMode,
      answerInputMode: payload.answerInputMode
    });
    setStatus(saveStatus, "Réglages enregistrés.", "success");
  } catch (error) {
    setStatus(saveStatus, friendlyErrorMessage(error, "Erreur lors de l'enregistrement."), "error");
  }
});

$("#teamForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = $("#teamNameInput").value.trim();
  const color = $("#teamColorInput").value || TEAM_COLORS[0];
  setStatus(teamStatus, "Création de l'équipe...");
  try {
    await createTeam(roomId, name, color);
    $("#teamNameInput").value = "";
    setStatus(teamStatus, "Équipe ajoutée.", "success");
  } catch (error) {
    setStatus(teamStatus, friendlyErrorMessage(error, "Impossible d'ajouter l'équipe."), "error");
  }
});

function renderTeams() {
  const list = $("#teamsList");
  if (!list) return;
  list.innerHTML = "";

  if (!teams.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "Aucune équipe pour le moment.";
    list.appendChild(empty);
    return;
  }

  teams.forEach((team) => {
    const count = players.filter((player) => normalizeTeamId(player.teamId) === team.id).length;
    const joinUrl = publicUrl("vote.html", roomId, { team: team.id });

    const card = document.createElement("article");
    card.className = "team-manage-card";
    card.style.setProperty("--team", team.color);

    const head = document.createElement("div");
    head.className = "team-manage-head";
    const badge = document.createElement("span");
    badge.className = "team-dot";
    const title = document.createElement("strong");
    title.textContent = team.name;
    const meta = document.createElement("small");
    meta.textContent = `${team.score} pt${team.score > 1 ? "s" : ""} · ${count} joueur${count > 1 ? "s" : ""}`;
    head.append(badge, title, meta);

    const input = document.createElement("input");
    input.className = "share-url";
    input.value = joinUrl;
    input.readOnly = true;

    const actions = document.createElement("div");
    actions.className = "tiny-actions";

    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.textContent = "Copier lien équipe";
    copyBtn.addEventListener("click", async () => {
      await copyToClipboard(joinUrl);
      copyBtn.textContent = "Copié";
      setTimeout(() => copyBtn.textContent = "Copier lien équipe", 1200);
    });

    const openBtn = document.createElement("a");
    openBtn.className = "tiny-link";
    openBtn.href = joinUrl;
    openBtn.target = "_blank";
    openBtn.rel = "noopener";
    openBtn.textContent = "Ouvrir";

    const resetBtn = document.createElement("button");
    resetBtn.type = "button";
    resetBtn.textContent = "Score 0";
    resetBtn.addEventListener("click", () => update(ref(db, roomPath(roomId, `teams/${team.id}`)), { score: 0 }));

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "danger-mini";
    deleteBtn.textContent = "Supprimer";
    deleteBtn.addEventListener("click", async () => {
      try {
        await deleteTeam(roomId, team.id);
        setStatus(teamStatus, "Équipe supprimée.", "success");
      } catch (error) {
        setStatus(teamStatus, friendlyErrorMessage(error, "Suppression impossible."), "error");
      }
    });

    const qr = document.createElement("img");
    qr.className = "qr-code mini-qr";
    qr.alt = `QR code ${team.name}`;
    qr.loading = "lazy";
    qr.src = qrCodeUrl(joinUrl, 180);

    actions.append(copyBtn, openBtn, resetBtn, deleteBtn);
    card.append(head, input, actions, qr);
    list.appendChild(card);
  });
}
