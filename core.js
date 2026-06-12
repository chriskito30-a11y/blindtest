import { db, ref, get, set, update, remove } from "./firebase-config.js";

export const APP_NAME = "BlindTest Master";
export const ROOT_PATH = "blindRooms";

export const DEFAULT_CONFIG = {
  title: "BlindTest Master",
  subtitle: "Blind test live · Fais Ton Show",
  durationSec: 20,
  answerMode: "artist_title",
  allowTeamCreation: true,
  maxAnswersPerPlayer: 1,
  pointsFirst: 5,
  pointsSecond: 3,
  pointsThird: 1,
  revealAnswerOnScreen: true,
  updatedAt: 0
};

export const TEAM_COLORS = [
  "#ff4d6d",
  "#ffd166",
  "#38bdf8",
  "#8b5cf6",
  "#6ee7b7",
  "#fb923c",
  "#f472b6",
  "#a3e635"
];

export function $(selector, root = document) {
  return root.querySelector(selector);
}

export function $all(selector, root = document) {
  return Array.from(root.querySelectorAll(selector));
}

export function normalizeSlug(value, maxLength = 48) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength);
}

export const normalizeRoomId = (value) => normalizeSlug(value, 42);
export const normalizeTeamId = (value) => normalizeSlug(value, 36);

export function normalizeAnswer(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’']/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function getRoomIdFromUrl() {
  return normalizeRoomId(new URLSearchParams(window.location.search).get("room"));
}

export function getTeamIdFromUrl() {
  return normalizeTeamId(new URLSearchParams(window.location.search).get("team"));
}

export function roomPath(roomId, suffix = "") {
  const clean = normalizeRoomId(roomId);
  const cleanSuffix = String(suffix || "").replace(/^\/+/, "");
  return cleanSuffix ? `${ROOT_PATH}/${clean}/${cleanSuffix}` : `${ROOT_PATH}/${clean}`;
}

export function publicUrl(page, roomId, params = {}) {
  const url = new URL(page, window.location.href);
  url.searchParams.set("room", normalizeRoomId(roomId));
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      url.searchParams.set(key, String(value));
    }
  });
  return url.href;
}

export function qrCodeUrl(url, size = 220) {
  const cleanSize = Math.min(700, Math.max(120, Number.parseInt(size, 10) || 220));
  return `https://api.qrserver.com/v1/create-qr-code/?size=${cleanSize}x${cleanSize}&margin=12&data=${encodeURIComponent(url)}`;
}

export function randomRoomId() {
  const words = ["blind", "music", "show", "quiz", "battle", "scene", "micro", "master"];
  return `${words[Math.floor(Math.random() * words.length)]}-${Math.random().toString(36).slice(2, 7)}`;
}

export function randomId(prefix = "id") {
  const id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${String(id).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 32)}`;
}

export function clampDuration(value) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return DEFAULT_CONFIG.durationSec;
  return Math.min(180, Math.max(5, n));
}

export function clampAttempts(value) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return 1;
  return Math.min(5, Math.max(1, n));
}

export function clampPoints(value, fallback = 0) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(99, Math.max(0, n));
}

export async function sha256(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function makeSalt() {
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return Array.from(arr).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function hashRoomPassword(roomId, password, salt) {
  return sha256(`${normalizeRoomId(roomId)}|blindtest-master|${salt}|${password}`);
}

export async function ensureRoom(roomId, password) {
  const clean = normalizeRoomId(roomId);
  if (!clean) throw new Error("Choisis un nom de partie valide.");
  if (!password || password.length < 4) throw new Error("Choisis un mot de passe arbitre d'au moins 4 caractères.");

  const roomRef = ref(db, roomPath(clean));
  const snap = await get(roomRef);
  if (snap.exists()) return { roomId: clean, created: false };

  const now = Date.now();
  const salt = makeSalt();
  const passwordHash = await hashRoomPassword(clean, password, salt);
  const teamA = "equipe-rouge";
  const teamB = "equipe-bleue";

  await set(roomRef, {
    config: { ...DEFAULT_CONFIG, updatedAt: now },
    teams: {
      [teamA]: { name: "Équipe Rouge", color: TEAM_COLORS[0], score: 0, createdAt: now },
      [teamB]: { name: "Équipe Bleue", color: TEAM_COLORS[2], score: 0, createdAt: now + 1 }
    },
    players: {},
    currentRound: defaultRound(),
    private: { salt, passwordHash, createdAt: now }
  });

  return { roomId: clean, created: true };
}

export async function verifyRoomPassword(roomId, password) {
  const snap = await get(ref(db, roomPath(roomId, "private")));
  if (!snap.exists()) return false;
  const data = snap.val() || {};
  if (!data.salt || !data.passwordHash) return false;
  const attempt = await hashRoomPassword(roomId, password, data.salt);
  return attempt === data.passwordHash;
}

export function rememberPassword(roomId, password) {
  sessionStorage.setItem(`blindMasterPassword:${normalizeRoomId(roomId)}`, password);
}

export function getRememberedPassword(roomId) {
  return sessionStorage.getItem(`blindMasterPassword:${normalizeRoomId(roomId)}`) || "";
}

export function safeConfig(config = {}) {
  const merged = { ...DEFAULT_CONFIG, ...(config || {}) };
  return {
    ...merged,
    durationSec: clampDuration(merged.durationSec),
    maxAnswersPerPlayer: clampAttempts(merged.maxAnswersPerPlayer),
    pointsFirst: clampPoints(merged.pointsFirst, DEFAULT_CONFIG.pointsFirst),
    pointsSecond: clampPoints(merged.pointsSecond, DEFAULT_CONFIG.pointsSecond),
    pointsThird: clampPoints(merged.pointsThird, DEFAULT_CONFIG.pointsThird),
    allowTeamCreation: merged.allowTeamCreation !== false,
    revealAnswerOnScreen: merged.revealAnswerOnScreen !== false,
    answerMode: ["title", "artist", "artist_title"].includes(merged.answerMode) ? merged.answerMode : "artist_title"
  };
}

export function defaultRound() {
  return {
    active: false,
    status: "waiting",
    roundId: "",
    roundNumber: 0,
    startedAt: 0,
    durationSec: DEFAULT_CONFIG.durationSec,
    answerMode: DEFAULT_CONFIG.answerMode,
    artist: "",
    title: "",
    youtubeVideoId: "",
    youtubeUrl: "",
    youtubeTitle: "",
    youtubeStartAt: 0,
    winnerAnswerId: "",
    winnerPlayerId: "",
    winnerTeamId: "",
    reveal: false,
    answers: {}
  };
}

export function safeTeams(teams = {}) {
  return Object.entries(teams || {})
    .map(([id, team]) => ({
      id,
      name: String(team?.name || id || "Équipe"),
      color: String(team?.color || TEAM_COLORS[0]),
      score: Number(team?.score || 0),
      createdAt: Number(team?.createdAt || 0)
    }))
    .sort((a, b) => (b.score - a.score) || (a.createdAt - b.createdAt) || a.name.localeCompare(b.name));
}

export function safePlayers(players = {}) {
  return Object.entries(players || {})
    .map(([id, player]) => ({
      id,
      name: String(player?.name || "Joueur"),
      teamId: normalizeTeamId(player?.teamId),
      score: Number(player?.score || 0),
      joinedAt: Number(player?.joinedAt || 0),
      lastSeenAt: Number(player?.lastSeenAt || 0)
    }))
    .sort((a, b) => (b.score - a.score) || a.name.localeCompare(b.name));
}

export function safeAnswers(round = {}) {
  return Object.entries(round?.answers || {})
    .map(([id, answer]) => ({
      id,
      playerId: String(answer?.playerId || ""),
      playerName: String(answer?.playerName || "Joueur"),
      teamId: normalizeTeamId(answer?.teamId),
      teamName: String(answer?.teamName || "Équipe"),
      text: String(answer?.text || ""),
      normalized: String(answer?.normalized || normalizeAnswer(answer?.text || "")),
      at: Number(answer?.at || 0),
      accepted: answer?.accepted === true,
      refused: answer?.refused === true,
      pointsAwarded: Number(answer?.pointsAwarded || 0)
    }))
    .sort((a, b) => a.at - b.at);
}

export function acceptedAnswers(round = {}) {
  return safeAnswers(round).filter((answer) => answer.accepted);
}

export function remainingSeconds(round = {}) {
  if (!round?.active || !round?.startedAt || !round?.durationSec) return 0;
  const end = Number(round.startedAt) + Number(round.durationSec) * 1000;
  return Math.max(0, Math.ceil((end - Date.now()) / 1000));
}

export function isRoundOpen(round = {}) {
  return Boolean(round?.active && round?.status === "playing" && remainingSeconds(round) > 0);
}

export function getDeviceId() {
  const key = "blindMasterDeviceId";
  let id = localStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID ? crypto.randomUUID() : `device-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(key, id);
  }
  return id.replace(/[^a-zA-Z0-9_-]/g, "");
}

export function playerStorageKey(roomId) {
  return `blindMasterPlayer:${normalizeRoomId(roomId)}`;
}

export function getSavedPlayer(roomId) {
  try {
    return JSON.parse(localStorage.getItem(playerStorageKey(roomId)) || "null");
  } catch {
    return null;
  }
}

export function savePlayer(roomId, player) {
  localStorage.setItem(playerStorageKey(roomId), JSON.stringify(player));
}

export function formatTimer(seconds) {
  const s = Math.max(0, Number(seconds) || 0);
  const min = Math.floor(s / 60);
  const sec = s % 60;
  return `${min}:${String(sec).padStart(2, "0")}`;
}

export function answerModeLabel(mode) {
  if (mode === "title") return "Titre uniquement";
  if (mode === "artist") return "Artiste uniquement";
  return "Artiste + titre";
}

export function expectedAnswerText(round = {}) {
  const artist = String(round.artist || round.revealedArtist || "").trim();
  const title = String(round.title || round.revealedTitle || "").trim();
  if (round.answerMode === "title") return title || "Titre non renseigné";
  if (round.answerMode === "artist") return artist || "Artiste non renseigné";
  return [artist, title].filter(Boolean).join(" — ") || "Réponse non renseignée";
}

export function nextPoints(config = {}, round = {}) {
  const cfg = safeConfig(config);
  const acceptedCount = acceptedAnswers(round).length;
  if (acceptedCount === 0) return cfg.pointsFirst;
  if (acceptedCount === 1) return cfg.pointsSecond;
  if (acceptedCount === 2) return cfg.pointsThird;
  return 0;
}

export async function createTeam(roomId, name, color = "") {
  const cleanName = String(name || "").trim();
  if (!cleanName) throw new Error("Nom d'équipe obligatoire.");
  const base = normalizeTeamId(cleanName) || `team-${Date.now()}`;
  let id = base;
  let count = 2;
  while ((await get(ref(db, roomPath(roomId, `teams/${id}`)))).exists()) {
    id = `${base}-${count}`.slice(0, 36);
    count += 1;
  }
  await set(ref(db, roomPath(roomId, `teams/${id}`)), {
    name: cleanName,
    color: color || TEAM_COLORS[Math.floor(Math.random() * TEAM_COLORS.length)],
    score: 0,
    createdAt: Date.now()
  });
  return id;
}

export async function deleteTeam(roomId, teamId) {
  const playersSnap = await get(ref(db, roomPath(roomId, "players")));
  const players = playersSnap.val() || {};
  const hasPlayers = Object.values(players).some((player) => normalizeTeamId(player?.teamId) === normalizeTeamId(teamId));
  if (hasPlayers) throw new Error("Impossible de supprimer une équipe qui contient déjà des joueurs.");
  await remove(ref(db, roomPath(roomId, `teams/${normalizeTeamId(teamId)}`)));
}

export async function copyToClipboard(text) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  const textarea = document.createElement("textarea");
  textarea.value = text;
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
  return Promise.resolve();
}

export function extractYouTubeId(input) {
  const raw = String(input || "").trim();
  if (!raw) return "";
  if (/^[a-zA-Z0-9_-]{11}$/.test(raw)) return raw;
  try {
    const url = new URL(raw);
    if (url.hostname.includes("youtu.be")) {
      const candidate = url.pathname.split("/").filter(Boolean)[0];
      return /^[a-zA-Z0-9_-]{11}$/.test(candidate) ? candidate : "";
    }
    if (url.hostname.includes("youtube.com") || url.hostname.includes("youtube-nocookie.com")) {
      const fromV = url.searchParams.get("v");
      if (/^[a-zA-Z0-9_-]{11}$/.test(fromV || "")) return fromV;
      const parts = url.pathname.split("/").filter(Boolean);
      const idx = parts.findIndex((part) => ["embed", "shorts", "live"].includes(part));
      const candidate = idx >= 0 ? parts[idx + 1] : "";
      return /^[a-zA-Z0-9_-]{11}$/.test(candidate) ? candidate : "";
    }
  } catch {
    return "";
  }
  return "";
}

export function youtubeWatchUrl(videoId, startAt = 0) {
  const clean = extractYouTubeId(videoId);
  if (!clean) return "";
  const url = new URL(`https://www.youtube.com/watch?v=${clean}`);
  const start = Number.parseInt(startAt, 10) || 0;
  if (start > 0) url.searchParams.set("t", `${start}s`);
  return url.href;
}

export function renderOption(select, value, label) {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  select.appendChild(option);
}

export function setStatus(el, message = "", type = "") {
  if (!el) return;
  el.textContent = message;
  el.className = `status-text${type ? ` ${type}` : ""}`;
}
