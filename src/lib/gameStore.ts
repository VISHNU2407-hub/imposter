import type {
  ClueEntry,
  ClueRoundNumber,
  DecisionChoice,
  DecisionResult,
  Phase,
  PlayerId,
  RoomStateView,
  RoundResult,
  VoteEntry,
} from "./gameTypes";
import { MAX_CLUE_ROUNDS } from "./gameTypes";
import { WORD_PAIRS } from "./wordPairs";

export const MIN_PLAYERS = 3;

function pickRandom<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Cryptographically random code from an unambiguous alphabet. */
function generateCode(len: number): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < len; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

const CLUE_MAX_LEN = 120;
const NAME_MAX_LEN = 20;

interface Player {
  id: PlayerId;
  name: string;
  token: string;
  isHost: boolean;
  connected: boolean;
  score: number;
  ready: boolean;
  clue: string | null;
  votedFor: PlayerId | null;
  /** The player's choice during the current ROUND_DECISION phase ("vote" | "play"). */
  decision: DecisionChoice | null;
  lastSeen: number;
}

interface Room {
  code: string;
  phase: Phase;
  players: Player[];
  imposterId: PlayerId | null;
  /** The main secret word (everyone except the imposter). */
  mainWord: string | null;
  /** The related alternate word given only to the imposter. */
  imposterWord: string | null;
  turnOrder: PlayerId[];
  currentTurnIndex: number;
  clues: ClueEntry[];
  votes: VoteEntry[];
  result: RoundResult | null;
  /** Which clue round (1..3) is active / just completed. */
  clueRound: ClueRoundNumber;
  /** Aggregate of the last completed ROUND_DECISION, set once everyone decided. */
  decisionResult: DecisionResult | null;
  /** Names of players who left mid-round, so results still show real names. */
  departed: Map<PlayerId, string>;
  /** Points earned by players who left before scoring was applied (e.g. a departed imposter). */
  departedScores: Map<PlayerId, number>;
  /** Increments on every startGame; exposed to clients for round-scoped UI state. */
  roundNumber: number;
  createdAt: number;
}

/** Rooms must live on `globalThis` so dev-mode module reloads don't wipe games. */
const g = globalThis as unknown as { __imposterRooms?: Map<string, Room> };
const rooms: Map<string, Room> = g.__imposterRooms ?? new Map<string, Room>();
g.__imposterRooms = rooms;

const CONNECTED_WINDOW_MS = 45_000; // heartbeats older than this => shown disconnected
const STALE_KICK_MS = 10 * 60 * 1000; // hard-remove players silent this long
const ROOM_TTL_MS = 6 * 60 * 60 * 1000; // abandoned rooms are garbage-collected after 6h

function now() {
  return Date.now();
}

function sanitizeName(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, NAME_MAX_LEN);
}

function sanitizeClue(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, CLUE_MAX_LEN);
}

function newToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function touchPlayer(room: Room, player: Player) {
  player.lastSeen = now();
  player.connected = true;
}

function getPlayer(room: Room, token: string | null): Player | null {
  if (!token) return null;
  return room.players.find((p) => p.token === token) ?? null;
}

/** Most-voted player across all votes; ties preserved. */
function tallyVotes(votes: VoteEntry[]): Map<PlayerId, number> {
  const counts = new Map<PlayerId, number>();
  for (const v of votes) counts.set(v.targetId, (counts.get(v.targetId) ?? 0) + 1);
  return counts;
}

/** Credit points to a player, even if they already left the room. */
function creditScore(room: Room, playerId: PlayerId, points: number) {
  const p = room.players.find((x) => x.id === playerId);
  if (p) p.score += points;
  else room.departedScores.set(playerId, (room.departedScores.get(playerId) ?? 0) + points);
}

/**
 * Opportunistic global sweep: drop rooms whose TTL has lapsed, even if nobody
 * polls them anymore. Called from createRoom and getState; bounded work per
 * call (iterate the room map, which stays small in a party-game process).
 */
function sweepExpiredRooms() {
  const t = now();
  for (const [code, room] of rooms) {
    if (t - room.createdAt > ROOM_TTL_MS) rooms.delete(code);
  }
}

function buildResult(room: Room): RoundResult {
  const nameOf = (id: PlayerId | null | undefined): string =>
    room.players.find((p) => p.id === id)?.name ?? room.departed.get(id!) ?? "Unknown";

  const counts = tallyVotes(room.votes);
  let top = 0;
  for (const c of counts.values()) top = Math.max(top, c);

  const topIds =
    top > 0
      ? Array.from(counts.entries())
          .filter(([, c]) => c === top)
          .map(([id]) => id)
      : [];

  const mostVotedId = topIds.length === 1 ? topIds[0] : null;
  const mostVotedName =
    mostVotedId
      ? nameOf(mostVotedId)
      : topIds.length > 0
        ? topIds.map((id) => nameOf(id)).join(" & ")
        : null;
  const isTie = topIds.length > 1;

  const groupCorrect = mostVotedId !== null && mostVotedId === room.imposterId;

  // Points earned this round, per player, for the reveal UI ("+N" feedback).
  const roundScore = new Map<PlayerId, number>();

  // Scoring: correct => non-imposters who voted the imposter get +1.
  // Wrong/no majority => imposter gets +2. Departed players still receive their points.
  if (groupCorrect) {
    for (const v of room.votes) {
      if (v.targetId === room.imposterId && v.voterId !== room.imposterId) {
        creditScore(room, v.voterId, 1);
        roundScore.set(v.voterId, (roundScore.get(v.voterId) ?? 0) + 1);
      }
    }
  } else if (room.imposterId) {
    creditScore(room, room.imposterId, 2);
    roundScore.set(room.imposterId, 2);
  }

  return {
    imposterId: room.imposterId!,
    imposterName: nameOf(room.imposterId),
    mainWord: room.mainWord!,
    imposterWord: room.imposterWord!,
    mostVotedId,
    mostVotedName,
    topVoteCount: top,
    isTie,
    groupCorrect,
    playerScores: [
      ...room.players.map((p) => ({
        playerId: p.id,
        playerName: p.name,
        score: p.score,
        roundScore: roundScore.get(p.id) ?? 0,
      })),
      ...Array.from(room.departedScores.entries())
        .filter(([, score]) => score !== 0)
        .map(([id, score]) => ({
          playerId: id,
          playerName: room.departed.get(id) ?? "Unknown",
          score,
          roundScore: roundScore.get(id) ?? 0,
        })),
    ].sort((a, b) => b.score - a.score),
    voteTally: Array.from(counts.entries())
      .map(([id, c]) => ({
        targetId: id,
        targetName: nameOf(id),
        count: c,
      }))
      .sort((a, b) => b.count - a.count),
  };
}

/**
 * Resolve the current ROUND_DECISION phase: count every active player's
 * choice and apply the majority rule. A tie always means "play another
 * round" (only reachable before round 3, which never enters a decision).
 */
function resolveDecision(room: Room) {
  let voteCount = 0;
  let playCount = 0;
  for (const p of room.players) {
    if (p.decision === "vote") voteCount++;
    else if (p.decision === "play") playCount++;
  }
  const readyToVote = voteCount > playCount;
  room.decisionResult = { voteCount, playCount, outcome: readyToVote ? "vote" : "play" };
  // Decisions are consumed once counted; the next round starts with fresh ones.
  for (const p of room.players) p.decision = null;
  if (readyToVote) {
    room.phase = "VOTING";
  } else {
    // Start the next clue round (tie => play another round).
    room.clueRound = (room.clueRound + 1) as ClueRoundNumber;
    room.currentTurnIndex = 0;
    for (const p of room.players) p.clue = null;
    room.phase = "CLUE_PHASE";
  }
}

/**
 * Advance the round when everyone has acted:
 * CLUE_PHASE -> ROUND_DECISION (rounds 1-2) or VOTING (round 3)
 * ROUND_DECISION -> next CLUE_PHASE (round 2-3) or VOTING
 * VOTING -> REVEAL
 */
function maybeAdvance(room: Room) {
  if (room.phase === "CLUE_PHASE") {
    const allClued = room.turnOrder.every(
      (id) => room.players.find((p) => p.id === id)?.clue !== null,
    );
    if (allClued) {
      if (room.clueRound >= MAX_CLUE_ROUNDS) {
        // Round 3 complete: voting starts automatically, no decision phase.
        room.phase = "VOTING";
      } else {
        // Fresh decision phase: reset decisionResult and everyone's choice.
        room.decisionResult = null;
        for (const p of room.players) p.decision = null;
        room.phase = "ROUND_DECISION";
      }
    }
  } else if (room.phase === "ROUND_DECISION") {
    const allDecided = room.players.length > 0 && room.players.every((p) => p.decision !== null);
    if (allDecided) resolveDecision(room);
  } else if (room.phase === "VOTING") {
    const allVoted = room.turnOrder.every(
      (id) => room.players.find((p) => p.id === id)?.votedFor !== null,
    );
    if (allVoted) {
      room.result = buildResult(room);
      room.phase = "REVEAL";
    }
  }
}

function resetRound(room: Room) {
  room.imposterId = null;
  room.mainWord = null;
  room.imposterWord = null;
  room.turnOrder = [];
  room.currentTurnIndex = 0;
  room.clues = [];
  room.votes = [];
  room.result = null;
  room.clueRound = 1;
  room.decisionResult = null;
  room.departed.clear();
  room.departedScores.clear();
  for (const p of room.players) {
    p.ready = false;
    p.clue = null;
    p.votedFor = null;
    p.decision = null;
  }
  room.phase = "LOBBY";
}

function removePlayerInternal(room: Room, playerId: PlayerId): "removed" | "host-reassigned" | "empty" {
  const idx = room.players.findIndex((p) => p.id === playerId);
  if (idx === -1) return "removed";
  const [removed] = room.players.splice(idx, 1);
  room.turnOrder = room.turnOrder.filter((id) => id !== playerId);
  room.departed.set(playerId, removed.name);
  // Drop votes CAST by the departed player so ghosts cannot swing the tally.
  // Votes cast AGAINST them stay: they may have been the imposter.
  room.votes = room.votes.filter((v) => v.voterId !== playerId);

  if (room.players.length === 0) {
    rooms.delete(room.code);
    return "empty";
  }

  if (room.players.every((p) => !p.isHost)) {
    room.players[0].isHost = true; // deterministic: first remaining player
  }

  // Too few players to continue a round: bail back to LOBBY (simplest safe behavior).
  if (room.phase !== "LOBBY" && room.phase !== "REVEAL" && room.players.length < 2) {
    resetRound(room);
    return "removed";
  }

  // Keep the round flowing after a departure.
  if (room.phase === "CLUE_PHASE") {
    const firstUnclued = room.turnOrder.findIndex(
      (id) => room.players.find((p) => p.id === id)?.clue === null,
    );
    if (firstUnclued === -1) maybeAdvance(room);
    else room.currentTurnIndex = firstUnclued;
  } else if (room.phase === "ROUND_DECISION") {
    // A departed player's decision is dropped with their seat; re-evaluate now.
    maybeAdvance(room);
  } else if (room.phase === "VOTING") {
    maybeAdvance(room);
  } else if (room.phase === "ROLE_REVEAL") {
    maybeAdvanceReady(room);
  }
  return "removed";
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function createRoom(hostName: string): { roomCode: string; playerId: PlayerId; token: string; name: string } {
  sweepExpiredRooms();
  const name = sanitizeName(hostName);
  if (!name) throw new GameError("VALIDATION", "Player name is required");

  let code = generateCode(5);
  while (rooms.has(code)) code = generateCode(5);

  const host: Player = {
    id: newToken().slice(0, 12),
    name,
    token: newToken(),
    isHost: true,
    connected: true,
    score: 0,
    ready: false,
    clue: null,
    votedFor: null,
    decision: null,
    lastSeen: now(),
  };
  rooms.set(code, {
    code,
    phase: "LOBBY",
    players: [host],
    imposterId: null,
    mainWord: null,
    imposterWord: null,
    turnOrder: [],
    currentTurnIndex: 0,
    clues: [],
    votes: [],
    result: null,
    clueRound: 1,
    decisionResult: null,
    departed: new Map(),
    departedScores: new Map(),
    roundNumber: 0,
    createdAt: now(),
  });
  return { roomCode: code, playerId: host.id, token: host.token, name: host.name };
}

export function joinRoom(
  code: string,
  rawName: string,
): { roomCode: string; playerId: PlayerId; token: string; name: string } {
  const room = rooms.get(code.trim().toUpperCase());
  if (!room) throw new GameError("NOT_FOUND", "Room not found. Check the code.");
  const name = sanitizeName(rawName);
  if (!name) throw new GameError("VALIDATION", "Player name is required");

  // Rejoin with the same name reuses the existing seat (page refresh support).
  const existing = room.players.find((p) => p.name.toLowerCase() === name.toLowerCase());
  if (existing) {
    if (room.phase !== "LOBBY") {
      touchPlayer(room, existing);
      return { roomCode: room.code, playerId: existing.id, token: existing.token, name: existing.name };
    }
    touchPlayer(room, existing);
    return { roomCode: room.code, playerId: existing.id, token: existing.token, name: existing.name };
  }

  if (room.phase !== "LOBBY") {
    throw new GameError("GAME_STARTED", "Game already in progress. Wait for the next round.");
  }
  if (room.players.length >= 12) {
    throw new GameError("ROOM_FULL", "Room is full (max 12 players)");
  }

  // Distinct display names in the lobby: append a number when taken.
  let displayName = name;
  const taken = new Set(room.players.map((p) => p.name.toLowerCase()));
  if (taken.has(displayName.toLowerCase())) {
    let n = 2;
    while (taken.has(`${name} ${n}`.toLowerCase())) n++;
    displayName = `${name} ${n}`;
  }

  const player: Player = {
    id: newToken().slice(0, 12),
    name: displayName,
    token: newToken(),
    isHost: false,
    connected: true,
    score: 0,
    ready: false,
    clue: null,
    votedFor: null,
    decision: null,
    lastSeen: now(),
  };
  room.players.push(player);
  return { roomCode: room.code, playerId: player.id, token: player.token, name: player.name };
}

export class GameError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export function startGame(roomCode: string, token: string): void {
  const room = rooms.get(roomCode.trim().toUpperCase());
  if (!room) throw new GameError("NOT_FOUND", "Room not found");
  const player = getPlayer(room, token);
  if (!player || !player.isHost) throw new GameError("FORBIDDEN", "Only the host can start the game");
  if (room.phase !== "LOBBY") throw new GameError("BAD_STATE", "Game already started");
  if (room.players.length < MIN_PLAYERS) {
    throw new GameError("NOT_ENOUGH_PLAYERS", `Need at least ${MIN_PLAYERS} players`);
  }

  // New secret-word mechanic: pick a related pair and randomly assign which
  // side is the main word and which is the alternate. Exactly one random
  // player (the hidden imposter) receives the alternate word; everyone else
  // gets the main word. No player is ever told which side they received.
  const [sideA, sideB] = pickRandom(WORD_PAIRS);
  const mainIsFirst = Math.random() < 0.5;
  room.mainWord = mainIsFirst ? sideA : sideB;
  room.imposterWord = mainIsFirst ? sideB : sideA;
  room.roundNumber += 1;
  room.clueRound = 1;
  room.decisionResult = null;
  room.imposterId = pickRandom(room.players).id;
  for (const p of room.players) p.decision = null;
  // Fisher-Yates for an unbiased turn order.
  const shuffled = [...room.players];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  room.turnOrder = shuffled.map((p) => p.id);
  room.currentTurnIndex = 0;
  room.phase = "ROLE_REVEAL";
}

export function setReady(roomCode: string, token: string): void {
  const room = rooms.get(roomCode.trim().toUpperCase());
  if (!room || room.phase !== "ROLE_REVEAL") throw new GameError("BAD_STATE", "Not in reveal phase");
  const player = getPlayer(room, token);
  if (!player) throw new GameError("FORBIDDEN", "Not a player in this room");
  player.ready = true;
  maybeAdvanceReady(room);
}

function maybeAdvanceReady(room: Room) {
  if (room.phase !== "ROLE_REVEAL") return;
  const all = room.players.length > 0 && room.players.every((p) => p.ready);
  if (all) {
    room.phase = "CLUE_PHASE";
  }
}

export function submitClue(roomCode: string, token: string, rawClue: string): void {
  const room = rooms.get(roomCode.trim().toUpperCase());
  if (!room) throw new GameError("NOT_FOUND", "Room not found");
  if (room.phase !== "CLUE_PHASE") throw new GameError("BAD_STATE", "Not in clue phase");

  const player = getPlayer(room, token);
  if (!player) throw new GameError("FORBIDDEN", "Not a player in this room");
  if (room.turnOrder[room.currentTurnIndex] !== player.id) {
    throw new GameError("NOT_YOUR_TURN", "It is not your turn");
  }
  if (player.clue !== null) throw new GameError("ALREADY_SUBMITTED", "You already submitted a clue");

  const clue = sanitizeClue(rawClue);
  if (!clue) throw new GameError("VALIDATION", "Clue cannot be empty");

  player.clue = clue;
  room.clues.push({
    playerId: player.id,
    playerName: player.name,
    text: clue,
    turnNumber: room.currentTurnIndex + 1,
    round: room.clueRound,
  });
  room.currentTurnIndex += 1;
  maybeAdvance(room);
}

export function submitDecision(roomCode: string, token: string, rawChoice: unknown): void {
  const room = rooms.get(roomCode.trim().toUpperCase());
  if (!room) throw new GameError("NOT_FOUND", "Room not found");
  if (room.phase !== "ROUND_DECISION") throw new GameError("BAD_STATE", "Not in decision phase");

  const player = getPlayer(room, token);
  if (!player) throw new GameError("FORBIDDEN", "Not a player in this room");
  if (player.decision !== null) throw new GameError("ALREADY_DECIDED", "You already made a decision");

  const choice: DecisionChoice | null =
    rawChoice === "vote" ? "vote" : rawChoice === "play" ? "play" : null;
  if (!choice) throw new GameError("VALIDATION", "Invalid decision choice");

  player.decision = choice;
  maybeAdvance(room);
}

export function submitVote(roomCode: string, token: string, targetId: string): void {
  const room = rooms.get(roomCode.trim().toUpperCase());
  if (!room) throw new GameError("NOT_FOUND", "Room not found");
  if (room.phase !== "VOTING") throw new GameError("BAD_STATE", "Not in voting phase");

  const player = getPlayer(room, token);
  if (!player) throw new GameError("FORBIDDEN", "Not a player in this room");
  if (player.votedFor !== null) throw new GameError("ALREADY_VOTED", "You already voted");
  if (targetId === player.id) throw new GameError("SELF_VOTE", "You cannot vote for yourself");
  if (!room.players.some((p) => p.id === targetId)) {
    throw new GameError("VALIDATION", "Invalid vote target");
  }

  player.votedFor = targetId;
  room.votes.push({
    voterId: player.id,
    voterName: player.name,
    targetId,
    targetName: room.players.find((p) => p.id === targetId)?.name ?? "Unknown",
  });
  maybeAdvance(room);
}

export function playAgain(roomCode: string, token: string): void {
  const room = rooms.get(roomCode.trim().toUpperCase());
  if (!room) throw new GameError("NOT_FOUND", "Room not found");
  const player = getPlayer(room, token);
  if (!player || !player.isHost) throw new GameError("FORBIDDEN", "Only the host can start the next round");
  if (room.phase !== "REVEAL") throw new GameError("BAD_STATE", "Round not finished");
  resetRound(room);
}

/** Host-only: destroy the room entirely (everyone is kicked to home). */
export function closeRoom(roomCode: string, token: string): void {
  const code = roomCode.trim().toUpperCase();
  const room = rooms.get(code);
  if (!room) return; // already gone -> nothing to close
  const player = getPlayer(room, token);
  if (!player || !player.isHost) throw new GameError("FORBIDDEN", "Only the host can close the room");
  rooms.delete(code);
}

export function leaveRoom(roomCode: string, token: string): void {
  const room = rooms.get(roomCode.trim().toUpperCase());
  if (!room) return;
  const player = getPlayer(room, token);
  if (!player) return;
  removePlayerInternal(room, player.id);
}

export function getState(roomCode: string, token: string | null): RoomStateView {
  const code = roomCode.trim().toUpperCase();
  const room = rooms.get(code);
  if (!room) throw new GameError("NOT_FOUND", "Room not found");

  sweepExpiredRooms();
  const me = getPlayer(room, token);
  if (me) touchPlayer(room, me);

  // Sweep disconnected players and expired rooms on state reads (no timers needed).
  const t = now();
  if (t - room.createdAt > ROOM_TTL_MS) {
    rooms.delete(code);
    throw new GameError("NOT_FOUND", "Room expired");
  }
  for (const p of [...room.players]) {
    if (t - p.lastSeen > STALE_KICK_MS) {
      removePlayerInternal(room, p.id);
    } else {
      p.connected = t - p.lastSeen <= CONNECTED_WINDOW_MS;
    }
  }
  if (!rooms.has(code)) throw new GameError("NOT_FOUND", "Room not found");

  return {
    roomCode: room.code,
    phase: room.phase,
    roundNumber: room.roundNumber,
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      isHost: p.isHost,
      connected: p.connected,
      score: p.score,
    })),
    you: me
      ? {
          id: me.id,
          name: me.name,
          isHost: me.isHost,
          connected: me.connected,
          score: me.score,
        }
      : null,
    isHost: me?.isHost ?? false,
    minPlayers: MIN_PLAYERS,
    clues: room.clues,
    currentTurnPlayerId: room.phase === "CLUE_PHASE" ? (room.turnOrder[room.currentTurnIndex] ?? null) : null,
    currentTurnNumber: room.phase === "CLUE_PHASE" ? room.currentTurnIndex + 1 : 0,
    clueRound: room.clueRound,
    yourDecision: me?.decision ?? null,
    playersWhoDecided:
      room.phase === "ROUND_DECISION"
        ? room.players.filter((p) => p.decision !== null).map((p) => p.id)
        : [],
    decisionResult: room.decisionResult,
    playersReady: room.phase === "ROLE_REVEAL" ? room.players.filter((p) => p.ready).map((p) => p.id) : [],
    yourVoteTargetId: me?.votedFor ?? null,
    playersWhoVoted: room.phase === "VOTING" ? room.votes.map((v) => v.voterId) : [],
    result: room.phase === "REVEAL" ? room.result : null,
    yourRole:
      me && room.imposterId
        ? {
            // Token-scoped: a player only ever sees their OWN secret word, and
            // nothing here reveals whether they got the main or alternate word.
            secretWord: me.id === room.imposterId ? room.imposterWord : room.mainWord,
          }
        : null,
  } satisfies RoomStateView;
}
