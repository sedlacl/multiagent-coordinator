export interface CoordinationEvent {
  id: number;
  sourceSession: string | null;
  kind: string;
  payload: string;
  createdAt: string;
}
