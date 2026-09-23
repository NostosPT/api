#!/bin/sh
# Writes SeaweedFS's S3 identity config from env vars (so no credentials live in git),
# then hands over to the image's own entrypoint.
set -eu

: "${S3_ACCESS_KEY_ID:?S3_ACCESS_KEY_ID is required}"
: "${S3_SECRET_ACCESS_KEY:?S3_SECRET_ACCESS_KEY is required}"

umask 077
cat > /tmp/s3.json <<EOF
{
  "identities": [
    {
      "name": "nostos-api",
      "credentials": [{ "accessKey": "${S3_ACCESS_KEY_ID}", "secretKey": "${S3_SECRET_ACCESS_KEY}" }],
      "actions": ["Admin", "Read", "List", "Tagging", "Write"]
    }
  ]
}
EOF
chown seaweed:seaweed /tmp/s3.json

exec /entrypoint.sh "$@" -s3.config=/tmp/s3.json
