#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# face-e-demo  |  deploys every AWS resource using the AWS CLI (no SAM, no IaC
# framework, no database).  Idempotent: safe to re-run.
#
#   ./infrastructure/deploy.sh
#   ./infrastructure/deploy.sh --skip-frontend
#
# The API and the validation pipeline run as the Node + Express + TypeScript
# service in backend/ (start it with: cd backend && npm install && npm run dev).
# This script only provisions the AWS resources that service needs: the private
# S3 bucket, the Rekognition face collection, and an IAM role it can assume.
# ---------------------------------------------------------------------------
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CFG="$ROOT/infrastructure/config.env"
OUT="$ROOT/infrastructure/outputs.env"

# shellcheck disable=SC1090
set -a; source "$CFG"; set +a

SKIP_FRONTEND=0
[ "${1:-}" = "--skip-frontend" ] && SKIP_FRONTEND=1

AWS_REGION="${AWS_REGION:-ap-south-1}"
ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
BUCKET_NAME="${BUCKET_NAME:-face-e-demo-${ACCOUNT_ID}}"
SERVER_ROLE="${PROJECT_NAME}-server-role"
# URL of the Express API (override when the backend runs somewhere else, e.g.
# API_URL=https://api.example.com ./infrastructure/deploy.sh)
API_URL="${API_URL:-http://localhost:8787}"

log()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m ok\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31mERR\033[0m %s\n' "$*" >&2; exit 1; }

[ -n "${AWS_REGION:-}" ] || die "AWS_REGION not set"
aws sts get-caller-identity >/dev/null || die "AWS credentials invalid"

# ---------------------------------------------------------------------------
log "Rekognition availability in $AWS_REGION"
if ! aws rekognition list-collections --region "$AWS_REGION" >/dev/null 2>&1; then
  die "Amazon Rekognition is not usable in $AWS_REGION (ap-south-2 has no Rekognition endpoint)"
fi
ok "Rekognition reachable"

# ---------------------------------------------------------------------------
log "S3 bucket $BUCKET_NAME"
if ! aws s3api head-bucket --bucket "$BUCKET_NAME" 2>/dev/null; then
  aws s3api create-bucket --bucket "$BUCKET_NAME" --region "$AWS_REGION" \
    --create-bucket-configuration LocationConstraint="$AWS_REGION" >/dev/null
fi
aws s3api put-public-access-block --bucket "$BUCKET_NAME" \
  --public-access-block-configuration '{
    "BlockPublicAcls": true, "IgnorePublicAcls": true,
    "BlockPublicPolicy": true, "RestrictPublicBuckets": true }' >/dev/null
aws s3api put-bucket-encryption --bucket "$BUCKET_NAME" --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"},"BucketKeyEnabled":true}]}' >/dev/null
aws s3api put-bucket-versioning --bucket "$BUCKET_NAME" --versioning-configuration Status=Enabled >/dev/null

aws s3api put-bucket-cors --bucket "$BUCKET_NAME" --cors-configuration "{
  \"CORSRules\": [{
    \"AllowedHeaders\": [\"*\"],
    \"AllowedMethods\": [\"PUT\", \"POST\", \"GET\", \"HEAD\"],
    \"AllowedOrigins\": [\"*\", \"$FRONTEND_ORIGIN\", \"http://localhost:5173\", \"http://127.0.0.1:5173\"],
    \"ExposeHeaders\": [\"ETag\", \"x-amz-request-id\"],
    \"MaxAgeSeconds\": 3600
  }]}" >/dev/null

aws s3api put-bucket-policy --bucket "$BUCKET_NAME" --policy "{
  \"Version\": \"2012-10-17\",
  \"Statement\": [
    { \"Sid\": \"DenyInsecureTransport\", \"Effect\": \"Deny\", \"Principal\": \"*\",
      \"Action\": \"s3:*\",
      \"Resource\": [\"arn:aws:s3:::$BUCKET_NAME\", \"arn:aws:s3:::$BUCKET_NAME/*\"],
      \"Condition\": { \"Bool\": { \"aws:SecureTransport\": \"false\" } } },
    { \"Sid\": \"DenyOversizedUpload\", \"Effect\": \"Deny\", \"Principal\": \"*\",
      \"Action\": \"s3:PutObject\",
      \"Resource\": \"arn:aws:s3:::$BUCKET_NAME/*\",
      \"Condition\": { \"NumericGreaterThan\": { \"aws:ContentLength\": \"$MAX_UPLOAD_BYTES\" } } },
    { \"Sid\": \"KeepObjectsPrivate\", \"Effect\": \"Deny\", \"Principal\": \"*\",
      \"Action\": [\"s3:GetObject\"],
      \"Resource\": \"arn:aws:s3:::$BUCKET_NAME/*\",
      \"Condition\": { \"StringNotLike\": { \"aws:PrincipalArn\": [
        \"arn:aws:iam::$ACCOUNT_ID:root\",
        \"arn:aws:iam::$ACCOUNT_ID:*\",
        \"arn:aws:sts::$ACCOUNT_ID:assumed-role/*\" ] } } }
  ]}" >/dev/null
ok "bucket private, encrypted, size-capped, CORS restricted"

# ---------------------------------------------------------------------------
log "Rekognition face collection $COLLECTION_ID"
if ! aws rekognition describe-collection --collection-id "$COLLECTION_ID" \
      --region "$AWS_REGION" >/dev/null 2>&1; then
  aws rekognition create-collection --collection-id "$COLLECTION_ID" \
    --region "$AWS_REGION" >/dev/null
fi
ok "collection ready (0 faces = enroll members first, see scripts/enroll-face.sh)"

# ---------------------------------------------------------------------------
log "IAM role for the Express backend"
cat > /tmp/${PROJECT_NAME}-trust.json <<JSON
{ "Version": "2012-10-17",
  "Statement": [{ "Effect": "Allow",
    "Principal": { "Service": ["ec2.amazonaws.com", "ecs-tasks.amazonaws.com"] },
    "Action": "sts:AssumeRole" }] }
JSON

aws iam get-role --role-name "$SERVER_ROLE" >/dev/null 2>&1 || \
  aws iam create-role --role-name "$SERVER_ROLE" \
    --assume-role-policy-document file:///tmp/${PROJECT_NAME}-trust.json \
    --description "face-e-demo Node/Express API (presign/result/preview + validation pipeline)" >/dev/null

cat > /tmp/${PROJECT_NAME}-server-policy.json <<JSON
{ "Version": "2012-10-17",
  "Statement": [
    { "Effect": "Allow",
      "Action": ["s3:GetObject","s3:HeadObject"],
      "Resource": ["arn:aws:s3:::$BUCKET_NAME/results/*","arn:aws:s3:::$BUCKET_NAME/uploads/*"] },
    { "Effect": "Allow",
      "Action": ["s3:PutObject"],
      "Resource": ["arn:aws:s3:::$BUCKET_NAME/results/*","arn:aws:s3:::$BUCKET_NAME/uploads/*"] },
    { "Effect": "Allow",
      "Action": ["s3:ListBucket"],
      "Resource": "arn:aws:s3:::$BUCKET_NAME" },
    { "Effect": "Allow",
      "Action": ["rekognition:DetectFaces","rekognition:SearchFacesByImage","rekognition:DetectText"],
      "Resource": "*" },
    { "Effect": "Allow",
      "Action": ["rekognition:DescribeCollection","rekognition:ListFaces","rekognition:IndexFaces"],
      "Resource": "arn:aws:rekognition:$AWS_REGION:$ACCOUNT_ID:collection/$COLLECTION_ID" }
  ] }
JSON

aws iam put-role-policy --role-name "$SERVER_ROLE" \
  --policy-name "${PROJECT_NAME}-server" \
  --policy-document file:///tmp/${PROJECT_NAME}-server-policy.json >/dev/null

SERVER_ROLE_ARN="$(aws iam get-role --role-name "$SERVER_ROLE" --query Role.Arn --output text)"
ok "role present (policy re-applied on every run)"

# ---------------------------------------------------------------------------
if [ "$SKIP_FRONTEND" -eq 0 ]; then
  log "Frontend env"
  mkdir -p "$ROOT/frontend"
  cat > "$ROOT/frontend/.env" <<EOF
VITE_API_BASE_URL=$API_URL
VITE_AWS_REGION=$AWS_REGION
VITE_BUCKET_NAME=$BUCKET_NAME
EOF
  ok "frontend/.env -> VITE_API_BASE_URL=$API_URL"
fi

cat > "$OUT" <<EOF
AWS_REGION=$AWS_REGION
ACCOUNT_ID=$ACCOUNT_ID
BUCKET_NAME=$BUCKET_NAME
COLLECTION_ID=$COLLECTION_ID
API_URL=$API_URL
SERVER_ROLE_NAME=$SERVER_ROLE
SERVER_ROLE_ARN=$SERVER_ROLE_ARN
EOF

echo
ok "DEPLOYED"
echo "    API_URL      = $API_URL"
echo "    bucket       = $BUCKET_NAME"
echo "    collection   = $COLLECTION_ID"
echo "    iam role     = $SERVER_ROLE"
echo "    outputs      = infrastructure/outputs.env"
echo
echo "    start the API = cd backend && npm install && npm run dev"
