export interface User {
  id: string;
  username: string;
  isBot: boolean;
  avatar: string;
}

export interface Entry {
  id: string;
  userId: string;
  username: string;
  timestamp: number;
  amount: number; // Always increments of 2
}

export interface Block {
  id: number;
  startTime: number;
  endTime: number | null; // Null if active
  entries: Entry[];
  status: 'WAITING' | 'active' | 'processing' | 'completed';
  totalPot: number;
  winnerId: string | null;
  distribution: BlockDistribution | null;
  aiCommentary?: string;
}

export interface BlockDistribution {
  winnerAmount: number; // 90%
  houseAmount: number; // 2%
  spreadAmount: number; // 8%
  spreadRecipients: { userId: string; amount: number }[]; // Top 20
}

export interface MetaRaffleState {
  blocksCompleted: number; // 0-100
  topContributors: Map<string, number>; // UserId -> Total Contribution Amount
}

export enum GameActionType {
  ADD_ENTRY,
  CLOSE_BLOCK,
  UPDATE_TIME,
  START_NEW_BLOCK,
}