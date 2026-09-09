export interface Message {
  id: string;
  from: string;
  to: string;
  body: string;
  ts: string;
  readAt?: string;
}
