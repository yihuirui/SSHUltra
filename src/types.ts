export type Profile = { id: string; name: string; group: string; host: string; port: number; username: string; authType: 'password' | 'key' | 'agent'; keyPath: string; color: string };
export type Credentials = { password?: string; passphrase?: string };
export type SessionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';
export type Session = { id: string; profile: Profile; status: SessionStatus; message?: string; connectAttempt: number };
export type Entry = { name: string; directory: boolean; symlink: boolean; size: number; modified: number; mode: number };
export type Transfer = { type: 'transfer'; id: string; transferId: string; direction: string; name: string; bytes: number; status: string; message?: string };
export type HarborEvent = { type: 'status'; id: string; status: SessionStatus; message?: string } | { type: 'data'; id: string; data: string; bytes: number } | { type: 'profiles'; profiles: Profile[] } | Transfer;
export interface API {
  init(): Promise<{ profiles: Profile[]; version: string; platform: string }>;
  saveProfile(profile: Partial<Profile>): Promise<Profile>;
  deleteProfile(id: string): Promise<boolean>;
  pickKey(): Promise<string | null>;
  connect(id: string, profile: Profile, credentials: Credentials, geometry: { cols: number; rows: number }): Promise<{ id: string }>;
  disconnect(id: string): Promise<void>;
  input(id: string, data: string): Promise<void>;
  resize(id: string, cols: number, rows: number): Promise<void>;
  ack(id: string, bytes: number): Promise<void>;
  batch(ids: string[], command: string): Promise<{ canceled: boolean; results: { id: string; sent: boolean; message?: string }[] }>;
  list(id: string, directory: string): Promise<{ path: string; entries: Entry[] }>;
  upload(id: string, directory: string): Promise<{ bytes: number } | null>;
  download(id: string, remote: string): Promise<{ bytes: number } | null>;
  exportScrollback(content: string): Promise<boolean>;
  newWindow(): Promise<boolean>;
  onEvent(listener: (event: HarborEvent) => void): () => void;
}
declare global { interface Window { harbor: API } }
