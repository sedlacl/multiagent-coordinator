export interface CoordinationState {
  summary?: string;
  directives?: string[];
  decisions?: string[];
  activeWork?: string[];
  queuedWork?: string[];
  blockers?: string[];
  notes?: string[];
}

export interface StoredState {
  scope: string;
  version: number;
  state: CoordinationState;
  updatedAt: string;
}

export interface CoordinationEvent {
  id: number;
  scope: string;
  sourceSession: string | null;
  kind: string;
  payload: string;
  createdAt: string;
}
