#!/bin/sh
# Creates the production env file from .env.prod.example, generating every
# CHANGE_ME secret. Refuses to overwrite an existing file.
#
#   deploy/init-env.sh /opt/nostos/api/.env.prod
set -eu

target="${1:-}"
template="$(dirname "$0")/../.env.prod.example"

if [ -z "$target" ]; then
	echo "usage: $0 <path to env file>" >&2
	exit 2
fi

if [ -e "$target" ]; then
	echo "$target already exists; not overwriting." >&2
	exit 1
fi

secret() {
	openssl rand -hex "$1"
}

mkdir -p "$(dirname "$target")"
umask 077

while IFS= read -r line; do
	case "$line" in
		COOKIE_SECRET=CHANGE_ME) echo "COOKIE_SECRET=$(secret 32)" ;;
		POSTGRES_PASSWORD=CHANGE_ME) echo "POSTGRES_PASSWORD=$(secret 24)" ;;
		S3_ACCESS_KEY_ID=CHANGE_ME) echo "S3_ACCESS_KEY_ID=nostos-$(secret 8)" ;;
		S3_SECRET_ACCESS_KEY=CHANGE_ME) echo "S3_SECRET_ACCESS_KEY=$(secret 32)" ;;
		BACKUP_ENCRYPTION_PASSWORD=CHANGE_ME) echo "BACKUP_ENCRYPTION_PASSWORD=$(secret 32)" ;;
		BACKUP_ENCRYPTION_SALT=CHANGE_ME) echo "BACKUP_ENCRYPTION_SALT=$(secret 32)" ;;
		*) printf '%s\n' "$line" ;;
	esac
done < "$template" > "$target"

echo "Created $target (mode 600) with generated secrets."
echo "Now edit the network, domain and BACKUP_S3_* values, and save"
echo "BACKUP_ENCRYPTION_PASSWORD / BACKUP_ENCRYPTION_SALT in a password manager."
