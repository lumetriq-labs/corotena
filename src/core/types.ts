export type MemberId = string;

export interface Member {
  id: MemberId;
  name: string;
  active: boolean;
  /** Removed from the roster but still referenced by past rounds. */
  archived?: boolean;
}

export type Team = [MemberId, MemberId];

export interface Match {
  a: Team;
  b: Team;
}

export interface Round {
  matches: Match[];
  rest: MemberId[];
}

/** Which rule wins when both can't be satisfied. Both are always applied best-effort. */
export type Priority = "rest" | "variety";

export const MAX_COURTS = 4;
