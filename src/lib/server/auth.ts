import { getApps, initializeApp, applicationDefault } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import type { PublicAuthConfig } from "@/lib/math";

export interface VerifiedCaller {
  authorized: boolean;
  status: number;
  uid: string;
  email: string | null;
  error?: string;
}

export function isAuthRequired(): boolean {
  return process.env.AUTH_REQUIRED === "true";
}

export function getPublicAuthConfig(): PublicAuthConfig {
  const authRequired = isAuthRequired();
  const apiKey =
    process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? process.env.FIREBASE_API_KEY ?? "";
  const authDomain =
    process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ??
    process.env.FIREBASE_AUTH_DOMAIN ??
    "";
  const projectId =
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ??
    process.env.GOOGLE_CLOUD_PROJECT ??
    process.env.GCP_PROJECT_ID ??
    "";
  const appId =
    process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? process.env.FIREBASE_APP_ID ?? "";

  const firebaseConfigured = Boolean(apiKey && authDomain && projectId);

  return {
    authRequired,
    firebaseConfigured,
    firebase: firebaseConfigured
      ? {
          apiKey,
          authDomain,
          projectId,
          appId,
        }
      : null,
  };
}

function ensureFirebaseAdmin() {
  if (getApps().length === 0) {
    const projectId =
      process.env.GOOGLE_CLOUD_PROJECT ??
      process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ??
      process.env.GCP_PROJECT_ID;
    initializeApp(
      projectId
        ? { credential: applicationDefault(), projectId }
        : { credential: applicationDefault() },
    );
  }
  return getAuth();
}

function getAllowedEmails(): Set<string> {
  const raw = process.env.ALLOWED_EMAILS ?? "";
  const items = raw
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
  return new Set(items);
}

export async function verifyApiRequest(request: Request): Promise<VerifiedCaller> {
  if (!isAuthRequired()) {
    return {
      authorized: true,
      status: 200,
      uid: "default-trader",
      email: null,
    };
  }

  const header = request.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return {
      authorized: false,
      status: 401,
      uid: "",
      email: null,
      error: "Authentication required. Please sign in with Google.",
    };
  }

  try {
    const adminAuth = ensureFirebaseAdmin();
    const decoded = await adminAuth.verifyIdToken(match[1]);
    const email = decoded.email?.toLowerCase() ?? null;
    const allowlist = getAllowedEmails();
    if (allowlist.size > 0 && (!email || !allowlist.has(email))) {
      return {
        authorized: false,
        status: 403,
        uid: decoded.uid,
        email,
        error: "Your Google account is not in ALLOWED_EMAILS for this DeskMath instance.",
      };
    }
    return {
      authorized: true,
      status: 200,
      uid: decoded.uid,
      email,
    };
  } catch {
    return {
      authorized: false,
      status: 401,
      uid: "",
      email: null,
      error: "Invalid or expired Firebase ID token.",
    };
  }
}
