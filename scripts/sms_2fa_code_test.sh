WORKER_NAME_DEFAULT="telnyx-chatwoot-relay"
DOMAIN_DEFAULT="c2f-cleaning"

green='\033[0;32m'
red='\033[0;31m'
yellow='\033[1;33m'
blue='\033[0;34m'
bold='\033[1m'
nc='\033[0m'

echo -e "${bold}${blue}-----------------------------------------------${nc}"
echo -e "${bold}${blue} Telnyx -> Chatwoot Inbound Webhook Test Runner ${nc}"
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

WEBHOOK_URL="https://${WORKER_NAME}.${DOMAIN}.workers.dev/webhooks/telnyx"

echo
echo -e "${yellow}Webhook URL:${nc} ${WEBHOOK_URL}"
read -r -p "Run test now? [Y/n]: " run_confirm
if [[ "$run_confirm" =~ ^[Nn]$ ]]; then
	echo -e "${yellow}Test canceled by user.${nc}"
	exit 0
fi

response_file="$(mktemp)"

http_code=$(curl -sS -o "$response_file" -w "%{http_code}" -X POST "$WEBHOOK_URL" \
	-H "Content-Type: application/json" \
	-d '{
    "data": {
      "event_type": "message.received",
      "payload": {
        "from": {
          "phone_number": "22395"
        },
        "text": "Test verification code: 123456",
        "media": []
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
