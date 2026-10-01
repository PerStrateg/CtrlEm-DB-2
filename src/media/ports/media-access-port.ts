/** Readiness of the optional broad website access the user may grant. */
export interface MediaAccessPort {
  openSettings(): Promise<void>;
  granted(): Promise<boolean>;
  subscribe(listener: (granted: boolean) => void): () => void;
}
