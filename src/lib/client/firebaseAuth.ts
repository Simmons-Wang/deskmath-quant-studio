import { getApps, initializeApp } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  type Auth,
  type User,
} from "firebase/auth";
import type { PublicAuthConfig } from "@/lib/math";

let cachedAuth: Auth | null = null;

export function getFirebaseClientAuth(config: PublicAuthConfig): Auth | null {
  if (!config.firebase) return null;
  if (cachedAuth) return cachedAuth;
  const app =
    getApps().length > 0 ? getApps()[0] : initializeApp(config.firebase);
  cachedAuth = getAuth(app);
  return cachedAuth;
}

export async function signInWithGoogleSmart(auth: Auth): Promise<void> {
  const provider = new GoogleAuthProvider();
  const isIosWebKit =
    typeof navigator !== "undefined" &&
    /iPad|iPhone|iPod/.test(navigator.userAgent);

  try {
    await signInWithPopup(auth, provider);
  } catch (err) {
    const code = (err as { code?: string })?.code ?? "";
    if (
      isIosWebKit ||
      code === "auth/popup-blocked" ||
      code === "auth/operation-not-supported-in-this-environment"
    ) {
      await signInWithRedirect(auth, provider);
      return;
    }
    throw err;
  }
}

export { onAuthStateChanged, signOut, type User };
