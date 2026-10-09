#!/usr/bin/env bash
# Enroll an organization member's face into the Rekognition collection.
#   ./infrastructure/scripts/enroll-face.sh <image.jpg> <member-id> [more.jpg ...]
#
# Each image is uploaded to S3 and referenced with an S3Object. Local file bytes
# are not sent directly: this AWS CLI build cannot read them (fileb:// is broken)
# and large photos exceed the base64 argv limit.
#
# Tip: to enroll a specific person from a group photo, pass a cropped image of
# that one face rather than the whole group (max-faces 1 indexes the largest).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck disable=SC1091
set -a; source "$ROOT/infrastructure/outputs.env"; set +a

usage() { echo "usage: $0 <image> <externalImageId> [image2 ...]"; exit 1; }
[ $# -ge 2 ] || usage

FIRST_IMAGE="$1"
MEMBER_ID="$2"
shift 2
set -- "$FIRST_IMAGE" "$@"

ctype_for() {
  case "$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')" in
    *.png) echo image/png ;;
    *.webp) echo image/webp ;;
    *) echo image/jpeg ;;
  esac
}

for IMAGE in "$@"; do
  [ -f "$IMAGE" ] || { echo "not found: $IMAGE" >&2; exit 1; }
  KEY="tmp/enroll-$(date +%s)-$RANDOM.$(basename "$IMAGE" | sed 's/.*\.//')"
  aws s3 cp "$IMAGE" "s3://$BUCKET_NAME/$KEY" --content-type "$(ctype_for "$IMAGE")" >/dev/null
  echo "==> indexing $IMAGE as $MEMBER_ID"
  aws rekognition index-faces \
    --region "$AWS_REGION" \
    --collection-id "$COLLECTION_ID" \
    --image "{\"S3Object\":{\"Bucket\":\"$BUCKET_NAME\",\"Name\":\"$KEY\"}}" \
    --external-image-id "$MEMBER_ID" \
    --detection-attributes '["DEFAULT"]' \
    --max-faces 1 \
    --quality-filter AUTO \
    --query 'FaceRecords[].{FaceId:Face.FaceId,External:Face.ExternalImageId,Confidence:Face.Confidence}' \
    --output table
  aws s3 rm "s3://$BUCKET_NAME/$KEY" >/dev/null
done

echo
aws rekognition list-faces --region "$AWS_REGION" --collection-id "$COLLECTION_ID" \
  --query 'Faces[].{Member:ExternalImageId,Confidence:Confidence,FaceId:FaceId}' --output table
