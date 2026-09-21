WORKER_NAME_DEFAULT="telnyx-chatwoot-relay"
DOMAIN_DEFAULT="c2f-cleaning"

green='\033[0;32m'
red='\033[0;31m'
yellow='\033[1;33m'
blue='\033[0;34m'
bold='\033[1m'
nc='\033[0m'

echo -e "${bold}${blue}-----------------------------------------------${nc}"
echo -e "${bold}${blue} Telnyx Mock Webhook Test Runner              ${nc}"
echo -e "${bold}${blue}-----------------------------------------------${nc}"

read -r -p "Is your Cloudflare Workers project name '${WORKER_NAME_DEFAULT}'? [Y/n]: " worker_confirm
if [[ "$worker_confirm" =~ ^[Nn]$ ]]; then
	read -r -p "Enter your Cloudflare Workers project name: " WORKER_NAME
	while [[ -z "$WORKER_NAME" ]]; do
		read -r -p "Project name cannot be empty. Enter it again: " WORKER_NAME
	done
else
	WORKER_NAME="$WORKER_NAME_DEFAULT"
fi

read -r -p "Enter your Cloudflare account domain (default: ${DOMAIN_DEFAULT}): " DOMAIN
DOMAIN="${DOMAIN:-$DOMAIN_DEFAULT}"

read -r -p "Enter your Telnyx international code (must start with +, example: +1): " TELNYX_COUNTRY_CODE
while [[ ! "$TELNYX_COUNTRY_CODE" =~ ^\+[0-9]+$ ]]; do
	read -r -p "Invalid international code. Use format like +1, +44, +234: " TELNYX_COUNTRY_CODE
done

read -r -p "Enter your Telnyx phone number without country code (digits only): " TELNYX_LOCAL_NUMBER
while [[ ! "$TELNYX_LOCAL_NUMBER" =~ ^[0-9]+$ ]]; do
	read -r -p "Invalid phone number. Enter digits only (no spaces/symbols): " TELNYX_LOCAL_NUMBER
done

TELNYX_PHONE="${TELNYX_COUNTRY_CODE}${TELNYX_LOCAL_NUMBER}"
WEBHOOK_URL="https://${WORKER_NAME}.${DOMAIN}.workers.dev/webhooks/telnyx"

echo
echo -e "${yellow}Webhook URL:${nc} ${WEBHOOK_URL}"
echo -e "${yellow}Telnyx destination number:${nc} ${TELNYX_PHONE}"
read -r -p "Run mock test now? [Y/n]: " run_confirm
if [[ "$run_confirm" =~ ^[Nn]$ ]]; then
	echo -e "${yellow}Mock test canceled by user.${nc}"
	exit 0
fi

response_file="$(mktemp)"

http_code=$(curl -sS -o "$response_file" -w "%{http_code}" -X POST "$WEBHOOK_URL" \
	-H "Content-Type: application/json" \
	-d '{
    "data": {
      "event_type": "message.received",
      "id": "test-uuid-1234",
      "payload": {
        "id": "test-msg-1234",
        "direction": "inbound",
        "from": {
          "phone_number": "+17195550199"
        },
        "to": [
          {
            "phone_number": "'"$TELNYX_PHONE"'"
          }
        ],
        "text": "Hello from mock test"
      }
    }
  }')
curl_exit=$?
response_body="$(cat "$response_file")"
rm -f "$response_file"

echo
echo -e "${bold}${blue}============== Test Result ==============${nc}"

if [[ $curl_exit -ne 0 ]]; then
	echo -e "${red}${bold}Result:${nc} ${red}Failed to call webhook${nc}"
	echo -e "${red}curl exited with code: ${curl_exit}${nc}"
	exit "$curl_exit"
fi

if [[ "$http_code" =~ ^2 ]]; then
	echo -e "${green}${bold}Result:${nc} ${green}Success${nc}"
	echo -e "${green}HTTP Code:${nc} ${http_code}"
	echo -e "${green}Response:${nc} ${response_body}"

	if [[ "$response_body" == *"Inbound processed"* ]]; then
		echo -e "${green}${bold}Expected response received: Inbound processed${nc}"
	else
		echo -e "${yellow}Note:${nc} Request succeeded, but response did not exactly match 'Inbound processed'."
	fi
else
	echo -e "${red}${bold}Result:${nc} ${red}Error${nc}"
	echo -e "${red}HTTP Code:${nc} ${http_code}"
	echo -e "${red}Response:${nc} ${response_body}"
	exit 1
fi
