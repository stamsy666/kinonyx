import { INITIAL_STATE, type PlayerState, type StateListener } from "./types";

/** Small observable used by adapters to publish state without pulling in a framework. */
export class StateStore {
  private state: PlayerState = { ...INITIAL_STATE };
  private listeners = new Set<StateListener>();

  get(): PlayerState {
    return this.state;
  }

  patch(partial: Partial<PlayerState>): void {
    this.state = { ...this.state, ...partial };
    for (const l of this.listeners) l(this.state);
  }

  reset(): void {
    this.patch({ ...INITIAL_STATE, volume: this.state.volume, muted: this.state.muted });
  }

  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  clear(): void {
    this.listeners.clear();
  }
}
