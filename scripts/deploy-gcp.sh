#!/usr/bin/env bash
set -euo pipefail

# Idempotent Google Cloud Run Deployment Script for DeskMath Quant Studio
# Follows gcp-nextjs-responsive-app blueprint (Always-Free friendly defaults)

RAW_DEFAULT_PROJECT="$(gcloud config get-value project 2>/dev/null || true)"
if [[ "${RAW_DEFAULT_PROJECT}" == "(unset)" ]]; then
  RAW_DEFAULT_PROJECT=""
fi
PROJECT_ID="${PROJECT_ID:-${RAW_DEFAULT_PROJECT}}"

if [[ -z "${PROJECT_ID}" ]]; then
  echo "==> No PROJECT_ID set. Checking your existing Google Cloud projects..."
  gcloud projects list --format="table(projectId,name,projectNumber)" || true
  if [[ -t 0 ]]; then
    read -r -p "Enter an existing GCP Project ID (or a new ID to create, e.g. deskmath-$(date +%s)): " INPUT_PROJECT_ID
    PROJECT_ID="${INPUT_PROJECT_ID:-}"
    if [[ -n "${PROJECT_ID}" ]] && ! gcloud projects describe "${PROJECT_ID}" >/dev/null 2>&1; then
      echo "==> Creating new GCP project: ${PROJECT_ID}"
      gcloud projects create "${PROJECT_ID}" --name="DeskMath Quant Studio"
    fi
  fi
fi

if [[ -z "${PROJECT_ID}" ]]; then
  echo "Error: PROJECT_ID is required."
  echo "Usage: PROJECT_ID=your-gcp-project-id GEMINI_API_KEY=optional-key ./scripts/deploy-gcp.sh"
  exit 1
fi

gcloud config set project "${PROJECT_ID}" >/dev/null

# Verify billing is linked cleanly before enabling Cloud Run / Firestore / Cloud Build
BILLING_ENABLED="$(gcloud billing projects describe "${PROJECT_ID}" --format='value(billingEnabled)' 2>/dev/null || true)"
if [[ "${BILLING_ENABLED}" != "True" && "${BILLING_ENABLED}" != "true" ]]; then
  echo ""
  echo "WARNING: Billing does not appear enabled on project '${PROJECT_ID}'."
  echo "Cloud Run, Cloud Build, and Secret Manager require a linked billing account (Always Free tier still applies)."
  echo "Link billing here: https://console.cloud.google.com/billing/linkedaccount?project=${PROJECT_ID}"
  if [[ -t 0 ]]; then
    read -r -p "Press Enter once billing is enabled (or Ctrl+C to abort)... " _
  fi
fi

REGION="${REGION:-us-central1}"
SERVICE_NAME="${SERVICE_NAME:-deskmath-quant-studio}"
AR_REPO="${AR_REPO:-deskmath-repo}"
SA_NAME="${SA_NAME:-deskmath-runner}"
SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
SAFE_PROJECT_SLUG="$(printf '%s' "${PROJECT_ID}" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9-]/-/g')"
GCS_BUCKET="${GCS_BUCKET:-${SAFE_PROJECT_SLUG}-deskmath-media}"
SECRET_NAME="${SECRET_NAME:-deskmath-gemini-api-key}"
AUTH_REQUIRED="${AUTH_REQUIRED:-false}"
ALLOWED_EMAILS="${ALLOWED_EMAILS:-}"
GEMINI_PRIMARY_MODEL="${GEMINI_PRIMARY_MODEL:-gemini-2.5-flash}"
GEMINI_LITE_MODEL="${GEMINI_LITE_MODEL:-gemini-2.5-flash-lite}"

echo "==> Deploying ${SERVICE_NAME} to project ${PROJECT_ID} (${REGION})"

echo "==> 1. Enabling required Google Cloud APIs..."
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  firestore.googleapis.com \
  storage.googleapis.com \
  secretmanager.googleapis.com \
  texttospeech.googleapis.com \
  --project="${PROJECT_ID}"

echo "==> 2. Ensuring runtime Service Account (${SA_EMAIL}) and least-privilege IAM..."
if ! gcloud iam service-accounts describe "${SA_EMAIL}" --project="${PROJECT_ID}" >/dev/null 2>&1; then
  gcloud iam service-accounts create "${SA_NAME}" \
    --display-name="DeskMath Cloud Run Runtime SA" \
    --project="${PROJECT_ID}"
  sleep 5
fi

for ROLE in \
  "roles/datastore.user" \
  "roles/storage.objectAdmin" \
  "roles/secretmanager.secretAccessor"; do
  gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
    --member="serviceAccount:${SA_EMAIL}" \
    --role="${ROLE}" \
    --condition=None \
    --quiet >/dev/null
done

echo "==> 3. Ensuring Cloud Firestore (Native mode in ${REGION})..."
if ! gcloud firestore databases describe --database="(default)" --project="${PROJECT_ID}" >/dev/null 2>&1; then
  gcloud firestore databases create \
    --database="(default)" \
    --location="${REGION}" \
    --type=firestore-native \
    --project="${PROJECT_ID}"
fi

echo "==> 4. Ensuring Google Cloud Storage bucket (gs://${GCS_BUCKET})..."
if ! gcloud storage buckets describe "gs://${GCS_BUCKET}" --project="${PROJECT_ID}" >/dev/null 2>&1; then
  gcloud storage buckets create "gs://${GCS_BUCKET}" \
    --location="${REGION}" \
    --default-storage-class=STANDARD \
    --uniform-bucket-level-access \
    --project="${PROJECT_ID}"
fi

echo "==> 5. Ensuring Artifact Registry (${AR_REPO}) with 2-image cleanup policy..."
if ! gcloud artifacts repositories describe "${AR_REPO}" --location="${REGION}" --project="${PROJECT_ID}" >/dev/null 2>&1; then
  gcloud artifacts repositories create "${AR_REPO}" \
    --repository-format=docker \
    --location="${REGION}" \
    --description="DeskMath container images" \
    --project="${PROJECT_ID}"
fi

TMP_POLICY="$(mktemp)"
cat > "${TMP_POLICY}" <<'JSON'
[
  {
    "name": "keep-latest-2",
    "action": { "type": "Keep" },
    "mostRecentVersions": { "keepCount": 2 }
  }
]
JSON
gcloud artifacts repositories set-cleanup-policies "${AR_REPO}" \
  --location="${REGION}" \
  --policy="${TMP_POLICY}" \
  --project="${PROJECT_ID}" \
  --no-dry-run >/dev/null 2>&1 || true
rm -f "${TMP_POLICY}"

echo "==> 6. Configuring Secret Manager (${SECRET_NAME})..."
HAS_SECRET_VERSION="false"
if ! gcloud secrets describe "${SECRET_NAME}" --project="${PROJECT_ID}" >/dev/null 2>&1; then
  gcloud secrets create "${SECRET_NAME}" \
    --replication-policy="automatic" \
    --project="${PROJECT_ID}"
fi

if [[ -n "${GEMINI_API_KEY:-}" ]]; then
  printf "%s" "${GEMINI_API_KEY}" | gcloud secrets versions add "${SECRET_NAME}" --data-file=- --project="${PROJECT_ID}" >/dev/null
  HAS_SECRET_VERSION="true"
elif gcloud secrets versions access latest --secret="${SECRET_NAME}" --project="${PROJECT_ID}" >/dev/null 2>&1; then
  HAS_SECRET_VERSION="true"
else
  echo "   (No GEMINI_API_KEY provided yet; deploying with built-in deterministic Quant Coach. You can add a Gemini key later in Settings.)"
fi

IMAGE_URI="${REGION}-docker.pkg.dev/${PROJECT_ID}/${AR_REPO}/${SERVICE_NAME}:latest"

echo "==> 7. Building container image via Google Cloud Build..."
gcloud builds submit --tag "${IMAGE_URI}" --project="${PROJECT_ID}"

echo "==> 8. Deploying to Google Cloud Run..."
ENV_VARS="^@^NODE_ENV=production@STORAGE_BACKEND=gcp@GOOGLE_CLOUD_PROJECT=${PROJECT_ID}@GCS_BUCKET_NAME=${GCS_BUCKET}@AUTH_REQUIRED=${AUTH_REQUIRED}@ALLOWED_EMAILS=${ALLOWED_EMAILS}@GEMINI_PRIMARY_MODEL=${GEMINI_PRIMARY_MODEL}@GEMINI_LITE_MODEL=${GEMINI_LITE_MODEL}@ALLOW_LOCAL_AI_FALLBACK=true"

DEPLOY_ARGS=(
  run deploy "${SERVICE_NAME}"
  "--image=${IMAGE_URI}"
  "--region=${REGION}"
  "--platform=managed"
  "--service-account=${SA_EMAIL}"
  "--allow-unauthenticated"
  "--min-instances=0"
  "--max-instances=2"
  "--cpu=1"
  "--memory=512Mi"
  "--concurrency=40"
  "--timeout=60"
  "--set-env-vars=${ENV_VARS}"
  "--project=${PROJECT_ID}"
)

if [[ "${HAS_SECRET_VERSION}" == "true" ]]; then
  DEPLOY_ARGS+=("--set-secrets=GEMINI_API_KEY=${SECRET_NAME}:latest")
fi

gcloud "${DEPLOY_ARGS[@]}"

SERVICE_URL="$(gcloud run services describe "${SERVICE_NAME}" --region="${REGION}" --project="${PROJECT_ID}" --format='value(status.url)')"
echo ""
echo "==> 9. Running live health smoke check..."
curl -fsS "${SERVICE_URL}/api/health" && echo ""
echo ""
echo "=================================================================="
echo "DeskMath Quant Studio is live 24/7 on Google Cloud Run!"
echo "Open on PC Chrome or iPhone Chrome: ${SERVICE_URL}"
echo "=================================================================="
