export const PHASES = [
  "LOBBY",
  "ROLE_REVEAL",
  "CLUE_PHASE",
  "ROUND_DECISION",
  "VOTING",
  "REVEAL",
] as const;

export type Phase = (typeof PHASES)[number];

export type PlayerId = string;

/** Which clue round (of a max of 3) the room is on. */
export type ClueRoundNumber = 1 | 2 | 3;

export const MAX_CLUE_ROUNDS: ClueRoundNumber = 3;

/** A player's answer during the ROUND_DECISION phase. */
export type DecisionChoice = "vote" | "play";

/** Private per-round recaps only demanded after a completed clue round. */
export interface DecisionResult {
  voteCount: number;
  playCount: number;
  /** "vote" => group ready to vote; "play" => another clue round (incl. ties). */
  outcome: "vote" | "play";
}

export interface PublicPlayer {
  id: PlayerId;
  name: string;
  isHost: boolean;
  connected: boolean;
  score: number;
}

export interface ClueEntry {
  playerId: PlayerId;
  playerName: string;
  text: string;
  turnNumber: number;
  /** Which clue round this clue belongs to (1..3). */
  round: ClueRoundNumber;
}

export interface VoteEntry {
  voterId: PlayerId;
  voterName: string;
  targetId: PlayerId;
  targetName: string;
}

export interface RevealedPlayerScore {
  playerId: PlayerId;
  playerName: string;
  score: number;
  /** Points earned this round (public info, part of the REVEAL-only result). */
  roundScore: number;
}

export interface RevealedVoteTally {
  targetId: PlayerId | null; // null => not applicable (no votes)
  targetName: string;
  count: number;
}

export interface RoundResult {
  imposterId: PlayerId;
  imposterName: string;
  /** The main secret word (everyone except the imposter). REVEAL-only. */
  mainWord: string;
  /** The alternate word the imposter received. REVEAL-only. */
  imposterWord: string;
  mostVotedId: PlayerId | null;
  mostVotedName: string | null;
  topVoteCount: number;
  isTie: boolean;
  groupCorrect: boolean;
  playerScores: RevealedPlayerScore[];
  voteTally: RevealedVoteTally[];
}

export interface RoomStateView {
  roomCode: string;
  phase: Phase;
  /** Increments every time the host starts a round; lets clients tag per-round drafts. */
  roundNumber: number;
  players: PublicPlayer[];
  you: PublicPlayer | null;
  isHost: boolean;
  // LOBBY
  minPlayers: number;
  // ROLE_REVEAL
  /** Token-scoped: only the requesting player's own secret word. No booleans. */
  yourRole: { secretWord: string | null } | null;
  playersReady: PlayerId[];
  // CLUE_PHASE
  clues: ClueEntry[];
  currentTurnPlayerId: PlayerId | null;
  currentTurnNumber: number;
  /** Which clue round (1..3) is active / just completed. */
  clueRound: ClueRoundNumber;
  // ROUND_DECISION
  yourDecision: DecisionChoice | null;
  playersWhoDecided: PlayerId[];
  /** Only non-null after the decision phase has resolved (all players decided). */
  decisionResult: DecisionResult | null;
  // VOTING
  yourVoteTargetId: PlayerId | null;
  playersWhoVoted: PlayerId[];
  // REVEAL
  result: RoundResult | null;
}
