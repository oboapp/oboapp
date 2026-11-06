export interface FacebookPage {
  id: string;
  name: string;
}

export type FacebookSessionPhase =
  | "authorizing"
  | "exchanging"
  | "selecting"
  | "saving"
  | "complete"
  | "failed";

export interface FacebookOAuthSession {
  id: string;
  browserHash: string;
  expiresAt: number;
  phase: FacebookSessionPhase;
  userTokenCipher: string | null;
  userHash: string | null;
  pages: FacebookPage[];
  pageName: string | null;
  connectionId: string | null;
}

export interface FacebookConnectionRecord {
  id: string;
  pageId: string;
  pageName: string;
  userHash: string;
  secretVersion: string;
  createdAt: number;
  status: "pending_review" | "revoked";
  collectionEnabled: false;
}

export interface FacebookUserRevocation {
  userHash: string;
  revokedAt: number;
  expiresAt: number;
}

export type FacebookConnectionErrorCode =
  | "cancelled"
  | "expired"
  | "permissions"
  | "provider"
  | "storage"
  | "invalid"
  | "rate_limit"
  | "too_many_pages";

export type FacebookConnectionView =
  | { status: "intro"; ready: boolean }
  | { status: "select"; pages: FacebookPage[]; csrfToken: string }
  | { status: "connected"; pageName: string }
  | { status: "error"; code: FacebookConnectionErrorCode };
