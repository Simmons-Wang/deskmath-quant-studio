# DeskMath Quant Studio (Next.js 16 + Google Cloud)

Full-stack quantitative trading mental-math trainer built with **Next.js 16 (App Router, standalone TypeScript, Vanilla CSS)** and engineered exclusively for **Google Cloud** (`Cloud Run`, `Cloud Firestore`, `Cloud Storage`, `Secret Manager`, `Gemini API`, optional `Firebase Auth` & `Cloud Text-to-Speech`), optimized for both **PC Chrome** and **iPhone Chrome (iOS WebKit)**.

## Key Features
- **Mixed Integer Operations (`+`, `−`, `×`, `÷`)**: 3-digit addition (`154 + 353`), 2×2 multiplication (`56 × 23`), integer subtraction (with optional negative results + iPhone `±` sign toggle), and exact integer division (`1288 ÷ 23`).
- **Dual Training Modes**:
  - **Visual Mode**: High-contrast tabular equation stage with real-time pace bar and live attempt tape.
  - **Voice: Audio + Keys**: Spoken equations (`0.8×–2.0×`) via Web Speech or Google Cloud Neural TTS with Blind Audio toggle and split timing (`reactionMs` vs post-speech `processingMs`).
  - **Voice: Hands-Free**: Speech synthesis + `SpeechRecognition` integer/command parser (`skip`, `repeat`, `stop`) with seamless keyboard/keypad fallback.
- **Mistake Review & Tiered Google Gemini Coach**:
  - Filterable, sortable mistake & slow-solve workbench (`Carry / Place-Value Slip`, `Units-Digit Slip`, `Sign Inversion`, `Slow Process Speed`), step-by-step left-to-right mental trick decomposition, trader notes, and inline **Practice Similar** sibling drills.
  - Tiered **Google AI Gemini** coach (`GEMINI_PRIMARY_MODEL` for deep bottleneck diagnostics & drill plans; `GEMINI_LITE_MODEL` for fast mistake Q&A) with deterministic fallback (`ALLOW_LOCAL_AI_FALLBACK=true`).
- **PC Chrome & iPhone Chrome Adaptive Shell**:
  - Single semantic `<nav className="app-nav">` rendering as a fixed 4-column bottom tab bar on iPhone (`< 860px`) with safe-area insets and as a sticky `232px` left rail on PC (`>= 860px`).
  - Installable iOS/Desktop PWA (`manifest.webmanifest`, `apple-touch-icon.png`).

---

## Deploy 24/7 on Google Cloud Run

Run the idempotent provisioning & deployment script from Google Cloud Shell or any machine with `gcloud` authenticated:

```bash
chmod +x scripts/deploy-gcp.sh
PROJECT_ID=your-gcp-project-id GEMINI_API_KEY=your-key ./scripts/deploy-gcp.sh
```

`scripts/deploy-gcp.sh` automatically configures:
1. **APIs**: Cloud Run, Cloud Build, Artifact Registry, Firestore, Cloud Storage, Secret Manager, and Cloud Text-to-Speech.
2. **Least-Privilege Service Account**: `roles/datastore.user`, `roles/storage.objectAdmin`, `roles/secretmanager.secretAccessor`.
3. **Cloud Firestore (Native, `us-central1`)** & **GCS Bucket** (uniform bucket-level access).
4. **Artifact Registry** with a 2-image cleanup policy (fits Google Cloud Always-Free 0.5 GB limit).
5. **Secret Manager** (`deskmath-gemini-api-key`) + **Cloud Run** deployment (`--min-instances=0 --max-instances=2 --cpu=1 --memory=512Mi`).

### Optional Personal Lockdown (Firebase Auth)
By default `AUTH_REQUIRED=false` (open access). To restrict your Cloud Run URL to your own Google account, set `AUTH_REQUIRED=true`, `ALLOWED_EMAILS=you@gmail.com`, and `NEXT_PUBLIC_FIREBASE_*` variables.

---

## Local Development & Verification

```bash
npm install
npm run dev          # Local dev with STORAGE_BACKEND=local (.local-data/)
npm run typecheck    # tsc --noEmit
npm run lint         # ESLint
npm test             # Domain & storage unit tests (tsx scripts/test-domain.ts)
npm run build        # Next.js 16 standalone production build
npm run e2e          # Dual-viewport Playwright E2E (iPhone 390x844 + PC 1280x800)
```
