#!/bin/sh
# Nostos API watchdog for the proxy VPS (DECISIONS.md: mutual watch).
#
# Polls the API's readiness URL through the public proxy, like a browser
# would. After WATCHDOG_FAILURE_THRESHOLD consecutive failures it emails
# ALERT_RECIPIENTS through Resend; after WATCHDOG_RECOVERY_THRESHOLD
# consecutive successes it emails a recovery. It covers what the API cannot
# report itself: the API process, its server, or the WireGuard link being down.
#
# Run once a minute (systemd timer in this directory). Needs only sh + curl.
#
#   watchdog.sh              one check (what the timer runs)
#   watchdog.sh test-email   send a test email to verify the configuration
#
# Configuration: environment variables, see watchdog.env.example.
set -eu

WATCHDOG_URL="${WATCHDOG_URL:-https://api.nostos.photos/v1/ready}"
WATCHDOG_TIMEOUT_SECONDS="${WATCHDOG_TIMEOUT_SECONDS:-10}"
WATCHDOG_FAILURE_THRESHOLD="${WATCHDOG_FAILURE_THRESHOLD:-3}"
WATCHDOG_RECOVERY_THRESHOLD="${WATCHDOG_RECOVERY_THRESHOLD:-2}"
WATCHDOG_STATE_DIR="${WATCHDOG_STATE_DIR:-/var/lib/nostos-watchdog}"
RESEND_API_KEY="${RESEND_API_KEY:-}"
ALERT_EMAIL_FROM="${ALERT_EMAIL_FROM:-}"
ALERT_RECIPIENTS="${ALERT_RECIPIENTS:-}"

STATE_FILE="${WATCHDOG_STATE_DIR}/state"

log() {
	printf '[watchdog] %s\n' "$*" >&2
}

is_count() {
	case "$1" in
		'' | *[!0-9]*) return 1 ;;
		*) [ "$1" -gt 0 ] ;;
	esac
}

require_count() {
	if ! is_count "$2"; then
		log "invalid $1: must be a positive integer"
		exit 2
	fi
}

require_count WATCHDOG_TIMEOUT_SECONDS "$WATCHDOG_TIMEOUT_SECONDS"
require_count WATCHDOG_FAILURE_THRESHOLD "$WATCHDOG_FAILURE_THRESHOLD"
require_count WATCHDOG_RECOVERY_THRESHOLD "$WATCHDOG_RECOVERY_THRESHOLD"

# --- Email (Resend HTTP API) -------------------------------------------------

json_escape() {
	printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g' | awk 'NR > 1 { printf "\\n" } { printf "%s", $0 }'
}

# Comma-separated list to a JSON array; rejects anything that is not a plain
# address so the request body cannot be altered through the configuration.
recipients_json() {
	json=""
	old_ifs="$IFS"
	IFS=","

	for address in $ALERT_RECIPIENTS; do
		address="$(printf '%s' "$address" | tr -d ' ')"

		[ -n "$address" ] || continue

		if ! printf '%s' "$address" | grep -Eq '^[A-Za-z0-9._+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'; then
			IFS="$old_ifs"
			log "invalid address in ALERT_RECIPIENTS"
			return 1
		fi

		json="${json:+${json},}\"${address}\""
	done

	IFS="$old_ifs"

	[ -n "$json" ] || return 1

	printf '[%s]' "$json"
}

# send_email <subject> <text>; returns non-zero when the email was not sent.
send_email() {
	if [ -z "$RESEND_API_KEY" ] || [ -z "$ALERT_EMAIL_FROM" ]; then
		log "email not configured (RESEND_API_KEY / ALERT_EMAIL_FROM)"
		return 1
	fi

	if ! to="$(recipients_json)"; then
		log "no valid ALERT_RECIPIENTS"
		return 1
	fi

	body="$(mktemp "${WATCHDOG_STATE_DIR}/email.XXXXXX")"
	printf '{"from":"%s","to":%s,"subject":"%s","text":"%s"}' \
		"$(json_escape "$ALERT_EMAIL_FROM")" "$to" "$(json_escape "$1")" "$(json_escape "$2")" > "$body"

	# The key goes to curl on stdin (--config -), never on the command line,
	# so it does not show up in the process list.
	status="$(printf 'header = "Authorization: Bearer %s"\n' "$RESEND_API_KEY" | curl --config - \
		--silent --show-error --output /dev/null --write-out '%{http_code}' \
		--max-time 15 \
		--header 'Content-Type: application/json' \
		--data-binary "@${body}" \
		https://api.resend.com/emails)" || status="000"

	rm -f "$body"

	case "$status" in
		2??) return 0 ;;
		*)
			log "email failed (HTTP ${status})"
			return 1
			;;
	esac
}

notify() {
	now="$(date -u '+%Y-%m-%d %H:%M:%S UTC')"

	if [ "$1" = "down" ]; then
		send_email "[Nostos] DOWN: API (watchdog)" "The Nostos API failed ${WATCHDOG_FAILURE_THRESHOLD} consecutive checks from the proxy VPS.

URL: ${WATCHDOG_URL}
Since: ${2}
Reason: ${3}
Checked: ${now}

The API, its server, or the link to the proxy may be down. You will get one more email when it recovers."
	else
		send_email "[Nostos] RECOVERED: API (watchdog)" "The Nostos API is answering again from the proxy VPS.

URL: ${WATCHDOG_URL}
Recovered: ${now}"
	fi
}

if [ "${1:-}" = "test-email" ]; then
	mkdir -p "$WATCHDOG_STATE_DIR"

	if send_email "[Nostos] Watchdog test" "Test email from the Nostos API watchdog on $(hostname). Alerts for ${WATCHDOG_URL} will arrive like this."; then
		log "test email sent"
		exit 0
	fi

	exit 1
fi

# --- State ---------------------------------------------------------------------
# confirmed: up | down | unknown (first run). streak: consecutive results that
# disagree with `confirmed`. pending: a notification that still has to go out.

confirmed="unknown"
streak=0
streak_since=""
streak_reason=""
pending=""
pending_since=""
pending_reason=""

mkdir -p "$WATCHDOG_STATE_DIR"

# key=value lines, parsed as data (never sourced): unknown keys are ignored
# and values are validated, so a corrupted file cannot run commands.
if [ -f "$STATE_FILE" ]; then
	while IFS='=' read -r key value; do
		case "$key" in
			confirmed) confirmed="$value" ;;
			streak) streak="$value" ;;
			streak_since) streak_since="$value" ;;
			streak_reason) streak_reason="$value" ;;
			pending) pending="$value" ;;
			pending_since) pending_since="$value" ;;
			pending_reason) pending_reason="$value" ;;
		esac
	done < "$STATE_FILE"
fi

case "$confirmed" in up | down | unknown) ;; *) confirmed="unknown" ;; esac
case "$pending" in up | down | "") ;; *) pending="" ;; esac
is_count "$streak" || streak=0

save_state() {
	tmp="$(mktemp "${WATCHDOG_STATE_DIR}/state.XXXXXX")"
	{
		printf 'confirmed=%s\n' "$confirmed"
		printf 'streak=%s\n' "$streak"
		printf 'streak_since=%s\n' "$streak_since"
		printf 'streak_reason=%s\n' "$streak_reason"
		printf 'pending=%s\n' "$pending"
		printf 'pending_since=%s\n' "$pending_since"
		printf 'pending_reason=%s\n' "$pending_reason"
	} > "$tmp"
	mv "$tmp" "$STATE_FILE"
}

# --- Check -------------------------------------------------------------------------

http_code="$(curl --silent --output /dev/null --write-out '%{http_code}' \
	--max-time "$WATCHDOG_TIMEOUT_SECONDS" --proto '=https,http' \
	--user-agent nostos-watchdog "$WATCHDOG_URL")" && curl_exit=0 || curl_exit=$?

if [ "$curl_exit" -eq 0 ] && [ "$http_code" = "200" ]; then
	result="up"
	reason=""
elif [ "$curl_exit" -eq 0 ]; then
	result="down"
	reason="not ready (HTTP ${http_code})"
else
	result="down"
	reason="unreachable (curl exit ${curl_exit})"
fi

if [ "$result" = "$confirmed" ]; then
	streak=0
	streak_since=""
	streak_reason=""
elif [ "$confirmed" = "unknown" ] && [ "$result" = "up" ]; then
	# A healthy first run is not news.
	confirmed="up"
	streak=0
else
	if [ "$streak" -eq 0 ]; then
		streak_since="$(date -u '+%Y-%m-%d %H:%M:%S UTC')"
	fi

	streak=$((streak + 1))

	if [ "$result" = "down" ]; then
		streak_reason="$reason"
		threshold="$WATCHDOG_FAILURE_THRESHOLD"
	else
		threshold="$WATCHDOG_RECOVERY_THRESHOLD"
	fi

	if [ "$streak" -ge "$threshold" ]; then
		log "state changed: ${confirmed} -> ${result} (${streak_reason:-ok})"
		confirmed="$result"
		pending="$result"
		pending_since="$streak_since"
		pending_reason="$streak_reason"
		streak=0
		streak_since=""
		streak_reason=""
	fi
fi

# A pending notification is retried every run until it is sent, unless the
# state changed again in the meantime (then the newer one replaces it).
if [ -n "$pending" ]; then
	if notify "$pending" "${pending_since:-unknown}" "${pending_reason:-unknown}"; then
		pending=""
		pending_since=""
		pending_reason=""
	fi
fi

save_state
