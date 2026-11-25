#!/usr/bin/env bash
set -euo pipefail

# Idempotent Google Cloud Run Deployment Script for DeskMath Quant Studio
# Follows gcp-nextjs-responsive-app blueprint (Always-Free friendly defaults)

PROJECT_ID="${PROJECT_ID:-$(gcloud config get-value project 2>/dev/null || true)}"
if [[ -z "${PROJECT_ID}" ]]; then
  echo "Error: PROJECT_ID is not set and no active gcloud project was found."
  echo "Usage: PROJECT_ID=your-gcp-project ./scripts/deploy-gcp.sh"
  exit 1
fi

REGION="${REGION:-us-central1}"
SERVICE_NAME="${SERVICE_NAME:-deskmath-quant-studio}"
AR_REPO="${AR_REPO:-deskmath-repo}"
SA_NAME="${SA_NAME:-deskmath-runner}"
SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
GCS_BUCKET="${GCS_BUCKET:-${PROJECT_ID}-deskmath-media}"
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
fi

for ROLE in \
  "roles/datastore.user" \
  "roles/storage.objectAdmin" \
  "roles/secretmanager.secretAccessor"; do
  gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
    --member="serviceAccount:${SA_EMAIL}" \
    --role="${ROLE}" \
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
  --no-dry-run >/dev/null || true
rm -f "${TMP_POLICY}"

echo "==> 6. Ensuring Secret Manager secret (${SECRET_NAME})..."
if ! gcloud secrets describe "${SECRET_NAME}" --project="${PROJECT_ID}" >/dev/null 2>&1; then
  gcloud secrets create "${SECRET_NAME}" \
    --replication-policy="automatic" \
    --project="${PROJECT_ID}"
  if [[ -n "${GEMINI_API_KEY:-}" ]]; then
    printf "%s" "${GEMINI_API_KEY}" | gcloud secrets versions add "${SECRET_NAME}" --data-file=- --project="${PROJECT_ID}"
  else
    printf "" | gcloud secrets versions add "${SECRET_NAME}" --data-file=- --project="${PROJECT_ID}"
  fi
elif [[ -n "${GEMINI_API_KEY:-}" ]]; then
  printf "%s" "${GEMINI_API_KEY}" | gcloud secrets versions add "${SECRET_NAME}" --data-file=- --project="${PROJECT_ID}"
fi

IMAGE_URI="${REGION}-docker.pkg.dev/${PROJECT_ID}/${AR_REPO}/${SERVICE_NAME}:latest"

echo "==> 7. Building container image via Google Cloud Build..."
gcloud builds submit --tag "${IMAGE_URI}" --project="${PROJECT_ID}"

echo "==> 8. Deploying to Google Cloud Run..."
gcloud run deploy "${SERVICE_NAME}" \
  --image="${IMAGE_URI}" \
  --region="${REGION}" \
  --platform=managed \
  --service-account="${SA_EMAIL}" \
  --allow-unauthenticated \
  --min-instances=0 \
  --max-instances=2 \
  --cpu=1 \
  --memory=512Mi \
  --concurrency=40 \
  --timeout=60 \
  --set-env-vars="NODE_ENV=production,STORAGE_BACKEND=gcp,GOOGLE_CLOUD_PROJECT=${PROJECT_ID},GCS_BUCKET_NAME=${GCS_BUCKET},AUTH_REQUIRED=${AUTH_REQUIRED},ALLOWED_EMAILS=${ALLOWED_EMAILS},GEMINI_PRIMARY_MODEL=${GEMINI_PRIMARY_MODEL},GEMINI_LITE_MODEL=${GEMINI_LITE_MODEL},ALLOW_LOCAL_AI_FALLBACK=true" \
  --set-secrets="GEMINI_API_KEY=${SECRET_NAME}:latest" \
  --project="${PROJECT_ID}"

SERVICE_URL="$(gcloud run services describe "${SERVICE_NAME}" --region="${REGION}" --project="${PROJECT_ID}" --format='value(status.url)')"
echo ""
echo "=================================================================="
echo "DeskMath deployed successfully to Google Cloud Run!"
echo "URL: ${SERVICE_URL}"
echo "=================================================================="
