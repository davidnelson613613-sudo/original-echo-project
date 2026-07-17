import type { LadderRung } from "./speed-mode";

export type FillEntry = {
  day: number;
  pct: number;
  shares: number;
  price: number;
  filledAt: string;
  auto: boolean;
};

export type Position = {
  symbol: string;
  totalCapital: number;
  scenario: string;
  createdAt: string;
  entries: FillEntry[];
  plannedLadder?: LadderRung[];
};

export type PositionMap = Record<string, Position>;

export type PositionSettings = {
  autoFill: boolean;
  recoveryCapture: boolean;
};

export const DEFAULT_POSITION_SETTINGS: PositionSettings = {
  autoFill: false,
  recoveryCapture: true,
};