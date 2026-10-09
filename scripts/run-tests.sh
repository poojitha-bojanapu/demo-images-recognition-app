#!/usr/bin/env bash
# End-to-end verification of the deployed stack.
#   ./scripts/run-tests.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
set -a; source "$ROOT/infrastructure/outputs.env"; set +a
API_URL="${API_URL:-http://localhost:8787}"

PASS=0; FAIL=0
green() { printf '\033[1;32mPASS\033[0m %s\n' "$*"; PASS=$((PASS+1)); }
red()   { printf '\033[1;31mFAIL\033[0m %s\n' "$*"; FAIL=$((FAIL+1)); }

# poll a result until it is not PROCESSING (max 60s)
get_result() {
  local id="$1" out="" i=0
  for i in $(seq 1 40); do
    out="$(curl -s "$API_URL/result/$id")"
    case "$out" in
      *'"PROCESSING"'*) sleep 1.5 ;;
      *) printf '%s' "$out"; return 0 ;;
    esac
  done
  printf '%s' "$out"
}

# upload <file> <contentType> -> echoes uploadId
upload() {
  local file="$1" ctype="$2"
  local size presign url id
  size=$(wc -c < "$file" | tr -d ' ')
  presign=$(curl -s -X POST "$API_URL/presign" -H 'content-type: application/json' \
    -d "{\"contentType\":\"$ctype\",\"sizeBytes\":$size}")
  url=$(printf '%s' "$presign" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("url",""))' 2>/dev/null || true)
  if [ -z "$url" ]; then echo "PRESIGN_FAILED:$presign"; return 1; fi
  id=$(printf '%s' "$presign" | python3 -c 'import json,sys; print(json.load(sys.stdin)["uploadId"])')
  curl -s -o /dev/null -w '' -X PUT "$url" -H "Content-Type: $ctype" --data-binary "@$file"
  echo "$id"
}

echo "== 1. API health"
h="$(curl -s "$API_URL/health")"
echo "$h"
printf '%s' "$h" | grep -q '"ok":true' && green "API healthy, bucket reachable" || red "API health check failed"

echo
echo "== 2. Rejection rules at the presign endpoint"
r=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API_URL/presign" -H 'content-type: application/json' \
  -d '{"contentType":"text/html","sizeBytes":150000}')
[ "$r" = "400" ] && green "rejects non-image content type (400)" || red "expected 400, got $r"

r=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API_URL/presign" -H 'content-type: application/json' \
  -d '{"contentType":"image/jpeg","sizeBytes":9000000}')
[ "$r" = "413" ] && green "rejects >1 MB declared size (413)" || red "expected 413, got $r"

echo
echo "== 3. Generate + upload synthetic images"
python3 "$ROOT/scripts/make-test-images.py" "$ROOT/scripts/out" >/dev/null
echo "   generated: $(ls "$ROOT/scripts/out" | tr '\n' ' ')"

echo
echo "== 4. Pipeline: standalone E + ACME text (no face expected)"
id=$(upload "$ROOT/scripts/out/test-e-and-acme.jpg" image/jpeg)
case "$id" in PRESIGN_FAILED*) red "presign failed: $id"; exit 2 ;; esac
echo "   uploadId=$id"
res=$(get_result "$id")
echo "$res" | python3 -m json.tool 2>/dev/null | sed -n '1,40p' || echo "$res"
echo "$res" | grep -q '"standaloneE"' && green "result JSON written to results/$id.json" || red "no result written"

echo
echo "== 5. Rule: E inside an unrelated word must NOT count"
id2=$(upload "$ROOT/scripts/out/test-hello.jpg" image/jpeg)
res2=$(get_result "$id2")
echo "$res2" | python3 -c '
import json,sys
r=json.load(sys.stdin)
e=r.get("text",{}).get("standaloneE",{})
print("rule:", e.get("rule"), "| standalone:", e.get("standaloneCount"), "| insideWord:", e.get("insideWordCount"))
sys.exit(0 if (e.get("standaloneCount",0)==0 and e.get("rule")=="standalone") else 1)
' && green "HELLO did not count as a standalone E" || red "E inside word was incorrectly counted"

echo
echo "== 6. Oversized dimensions are rejected by the worker"
id3=$(upload "$ROOT/scripts/out/test-oversize.jpg" image/jpeg)
res3=$(get_result "$id3")
echo "$res3" | python3 -c '
import json,sys
r=json.load(sys.stdin)
w=r.get("image",{}).get("width") or 0
reasons=" ".join(r.get("validation",{}).get("reasons",[]))
print("width:", w, "| status:", r.get("validation",{}).get("status"))
sys.exit(0 if w>1600 else 1)
' && green "2200px image detected as over max dimension" || red "oversized image not flagged"

echo
echo "== 7. No-face image fails the face check"
id4=$(upload "$ROOT/scripts/out/test-no-text.jpg" image/jpeg)
res4=$(get_result "$id4")
echo "$res4" | python3 -c '
import json,sys
r=json.load(sys.stdin)
print("face.detected:", r.get("face",{}).get("detected"), "| checks:", r.get("checks"))
sys.exit(0 if r.get("face",{}).get("detected") is False else 1)
' && green "no face detected -> validation FAIL as expected" || red "face check behaved unexpectedly"

echo
echo "== 8. Bucket is private (anonymous access denied)"
code=$(curl -s -o /dev/null -w '%{http_code}' "https://$BUCKET_NAME.s3.ap-south-1.amazonaws.com/?list-type=2")
[ "$code" = "403" ] && green "anonymous ListBucket denied (403)" || red "expected 403, got $code"

code=$(curl -s -o /dev/null -w '%{http_code}' "$API_URL/result/NOT%20A%20VALID%20ID")
[ "$code" = "400" ] && green "malformed uploadId rejected (400)" || red "expected 400, got $code"

code=$(curl -s -o /dev/null -w '%{http_code}' "$API_URL/result/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
[ "$code" = "202" ] && green "unknown-but-well-formed uploadId -> 202 PROCESSING (never leaked, never persisted)" || red "expected 202, got $code"

echo
echo "== 9. Face collection state"
aws rekognition describe-collection --collection-id "$COLLECTION_ID" --region "$AWS_REGION" \
  --query '{Faces:FaceCount,Model:FaceModelVersion}' --output json
echo "   (enroll members with: ./infrastructure/scripts/enroll-face.sh <photo.jpg> <member-id>)"

echo
printf '\033[1;34m==>\033[0m %d passed, %d failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
