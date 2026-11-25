#!/usr/bin/env bash
set -euo pipefail

# Used automatically by Cloud Run Button (app.json -> hooks.precreate)
PROJECT="${GOOGLE_CLOUD_PROJECT:-$(gcloud config get-value project 2>/dev/null || true)}"
REGION="${GOOGLE_CLOUD_REGION:-us-central1}"

if [[ -z "${PROJECT}" ]]; then
  echo "Skipping precreate setup (no GOOGLE_CLOUD_PROJECT detected)."
  exit 0
fi

echo "==> Enabling Firestore & Cloud Storage APIs for ${PROJECT}..."
gcloud services enable \
  firestore.googleapis.com \
  storage.googleapis.com \
  texttospeech.googleapis.com \
  --project="${PROJECT}" || true

echo "==> Ensuring Cloud Firestore (Native) database..."
if ! gcloud firestore databases describe --database="(default)" --project="${PROJECT}" >/dev/null 2>&1; then
  if ! gcloud firestore databases create --database="(default)" --location="${REGION}" --type=firestore-native --project="${PROJECT}" 2>/dev/null; then
    gcloud firestore databases create --database="(default)" --location="nam5" --type=firestore-native --project="${PROJECT}" || true
  fi
fi

BUCKET_SLUG="$(printf '%s' "${PROJECT}" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9-]/-/g')"
BUCKET="${BUCKET_SLUG}-deskmath-media"
if ! gcloud storage buckets describe "gs://${BUCKET}" --project="${PROJECT}" >/dev/null 2>&1; then
  gcloud storage buckets create "gs://${BUCKET}" \
    --location="${REGION}" \
    --default-storage-class=STANDARD \
    --uniform-bucket-level-access \
    --project="${PROJECT}" || true
fi
