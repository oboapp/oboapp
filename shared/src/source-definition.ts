/** Shape of a source entry */
export interface SourceDefinition {
  readonly id: string;
  readonly url: string;
  readonly name: string;
  readonly localities: readonly string[];
  /** When true, notifications from this source require the user to opt-in */
  readonly experimental?: boolean;
  /** When true, this crawler runs on the emergent (30-minute) schedule */
  readonly emergent?: boolean;
}
