#!/usr/bin/env bash
# Inspect the deployed Rekognition collection against a local image.
#   ./scripts/check-rekognition.sh <image.jpg>
#
# Prints: collection state, detected faces, collection match, and OCR text.
# Uploads the image to S3 and uses an S3Object reference because this AWS CLI
# build cannot read local image bytes (fileb:// is broken and base64 blows the
# argv limit for large photos).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
set -a; source "$ROOT/infrastructure/outputs.env"; set +a

IMAGE="${1:-}"
[ -n "$IMAGE" ] && [ -f "$IMAGE" ] || { echo "usage: $0 <image.jpg>" >&2; exit 1; }

KEY="tmp/rek-check-$(date +%s)-$RANDOM.jpg"
aws s3 cp "$IMAGE" "s3://$BUCKET_NAME/$KEY" --content-type image/jpeg >/dev/null
cleanup() { aws s3 rm "s3://$BUCKET_NAME/$KEY" >/dev/null 2>&1 || true; }
trap cleanup EXIT

IMG="{\"S3Object\":{\"Bucket\":\"$BUCKET_NAME\",\"Name\":\"$KEY\"}}"

echo "== Collection $COLLECTION_ID =="
aws rekognition describe-collection --region "$AWS_REGION" --collection-id "$COLLECTION_ID" \
  --query '{Faces:FaceCount,Model:FaceModelVersion}' --output table

echo
echo "== Enrolled members =="
aws rekognition list-faces --region "$AWS_REGION" --collection-id "$COLLECTION_ID" \
  --query 'Faces[].{Member:ExternalImageId,Confidence:Confidence,FaceId:FaceId}' --output table

echo
echo "== Detected faces in $IMAGE =="
aws rekognition detect-faces --region "$AWS_REGION" --image "$IMG" \
  --query 'FaceDetails[].{Confidence:Confidence,Yaw:Pose.Yaw,Sharpness:Quality.Sharpness}' \
  --output table

echo
echo "== Collection match (threshold ${FACE_MATCH_THRESHOLD:-92}) =="
aws rekognition search-faces-by-image --region "$AWS_REGION" --collection-id "$COLLECTION_ID" \
  --image "$IMG" --face-match-threshold "${FACE_MATCH_THRESHOLD:-92}" \
  --query 'FaceMatches[].{Similarity:Similarity,Member:Face.ExternalImageId,FaceId:Face.FaceId}' \
  --output table 2>/dev/null || echo "no match on the largest face (note: this API only checks the largest face)"

echo
echo "== OCR text =="
aws rekognition detect-text --region "$AWS_REGION" --image "$IMG" \
  --query 'TextDetections[?Type==`WORD`].{Text:DetectedText,Confidence:Confidence}' --output table
