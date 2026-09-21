# Chatwoot & Telnyx Two-Way SMS/MMS Integration via Cloudflare Workers

An ultra-lightweight, zero-maintenance, edge-hosted bridge connecting **Telnyx Programmable Messaging** to **Chatwoot API Channel Inboxes** using **Cloudflare Workers**.

This relay enables full two-way SMS/MMS messaging, threaded conversation management, native image/media attachment support, and event filtering—all running at edge speeds without requiring dedicated servers or containerized middleware.

---

## Deployment Options

You can deploy this integration in under 5 minutes using whichever method you prefer:

* 🚀 **Quick CLI Deployment (Recommended):** Fast 1-command deployment using `npx wrangler deploy` (see [Option A](#option-a-quick-cli-deployment-wrangler)).
* 🖥️ **Cloudflare Dashboard Web UI:** Simple copy-and-paste visual setup right inside your browser with no local terminal required (see [Option B](#option-b-dashboard-web-ui-setup)).

---

## Table of Contents

* [Chatwoot \& Telnyx Two-Way SMS/MMS Integration via Cloudflare Workers](#chatwoot--telnyx-two-way-smsmms-integration-via-cloudflare-workers)
  * [Deployment Options](#deployment-options)
  * [Table of Contents](#table-of-contents)
  * [Architecture \& How It Works](#architecture--how-it-works)
    * [Flow Breakdown](#flow-breakdown)
  * [Prerequisites](#prerequisites)
  * [Required Environment Variables](#required-environment-variables)
  * [Step-by-Step Setup Guide](#step-by-step-setup-guide)
    * [Step 1: Configure Chatwoot](#step-1-configure-chatwoot)
    * [Step 2: Configure Telnyx](#step-2-configure-telnyx)
    * [Step 3: Deploy the Cloudflare Worker](#step-3-deploy-the-cloudflare-worker)
      * [Option A: Quick CLI Deployment (Wrangler)](#option-a-quick-cli-deployment-wrangler)
      * [Option B: Dashboard Web UI Setup](#option-b-dashboard-web-ui-setup)
  * [Complete Worker Code (`worker.js`)](#complete-worker-code-workerjs)
  * [Testing the Integration](#testing-the-integration)
    * [1. Inbound SMS/MMS Test](#1-inbound-smsmms-test)
    * [2. Outbound Reply Test](#2-outbound-reply-test)
    * [3. Simulated cURL Inbound Test](#3-simulated-curl-inbound-test)
  * [Carrier Compliance \& 10DLC Regulations](#carrier-compliance--10dlc-regulations)
    * [What is A2P 10DLC?](#what-is-a2p-10dlc)
    * [Troubleshooting Error Code `40010`](#troubleshooting-error-code-40010)
    * [Cost Structure (Local US Numbers)](#cost-structure-local-us-numbers)
    * [Alternative: Toll-Free Verification (TFV)](#alternative-toll-free-verification-tfv)
  * [Troubleshooting \& FAQs](#troubleshooting--faqs)

---

## Architecture & How It Works

Chatwoot provides a native **API Channel** specifically designed for custom telecommunication integrations. The Cloudflare Worker acts as a stateless, zero-latency relay translating webhook payloads between Telnyx and Chatwoot.

```
[ Customer Handset ]
       │  ▲
   SMS │  │ Outbound SMS / MMS
   MMS │  │
       ▼  │
   [ Telnyx API ]
       │  ▲
       │  │ POST https://api.telnyx.com/v2/messages
       ▼  │
[ Cloudflare Worker Relay ]
  Endpoint A: /webhooks/telnyx   ──▶ (Resolves Contact/Thread, Uploads Media) ──▶ [ Chatwoot API ]
  Endpoint B: /webhooks/chatwoot ◀── (Filters Typing/Notes, Passes Payloads)  ◀── [ Agent Webhook ]
```

### Flow Breakdown

* **Inbound Flow (`/webhooks/telnyx`):**
  1. Telnyx receives an incoming text/MMS and fires a `message.received` event to the Worker.
  2. Worker queries Chatwoot's Contact Search API to locate the customer or create a new contact profile.
  3. Worker checks for an existing active (unresolved) conversation in the target inbox.
  4. If an active thread exists, it appends the incoming message; otherwise, it opens a new conversation thread.
  5. Incoming media/attachments (MMS) are downloaded and uploaded via `multipart/form-data` to display natively in Chatwoot.

* **Outbound Flow (`/webhooks/chatwoot`):**
  1. An agent replies inside Chatwoot.
  2. Chatwoot dispatches a `message_created` event to the Worker.
  3. Worker filters out typing indicators (`conversation_typing_on`/`off`) and internal staff notes (`private: true`).
  4. Worker resolves the recipient's E.164 phone number from the payload and fires an HTTP POST request to Telnyx (`https://api.telnyx.com/v2/messages`).

---

## Prerequisites

* **Cloudflare Account:** Free tier (includes 100,000 free Worker requests/day).
* **Telnyx Mission Control Portal:** Active Telnyx phone number and API v2 key.
* **Chatwoot Instance:** Self-hosted (Docker) or Cloud instance with Administrator privileges.

---

## Required Environment Variables

Before deploying the Worker, gather these six environment variables:

| Variable Name         | Description                              | Example / Where to Find                         |
| --------------------- | ---------------------------------------- | ----------------------------------------------- |
| `TELNYX_API_KEY`      | Telnyx API Key                           | Portal → Account Settings → API Keys (`KEY...`) |
| `CHATWOOT_API_TOKEN`  | User Access Token for API authentication | Profile Settings or dedicated Relay Bot agent   |
| `CHATWOOT_BASE_URL`   | Your Chatwoot URL (no trailing slash)    | `https://comms.yourdomain.com`                  |
| `CHATWOOT_ACCOUNT_ID` | Account numerical ID                     | Browser URL: `/app/accounts/{account_id}/...`   |
| `CHATWOOT_INBOX_ID`   | Inbox numerical ID                       | Settings → Inboxes → Click Inbox → URL end ID   |
| `TELNYX_PHONE_NUMBER` | Assigned Telnyx phone number (E.164)     | `+17198881555`                                  |

> 💡 **Best Practice for `CHATWOOT_API_TOKEN`:** Creating a dedicated **Relay Bot** agent user in Chatwoot (`Settings` → `Agents`) provides clean audit trails, prevents personal credential rotation from breaking the bridge, and separates privileges.

---

## Step-by-Step Setup Guide

### Step 1: Configure Chatwoot

1. Log in to your Chatwoot Dashboard.
2. Go to **Settings** → **Inboxes** → **Add Inbox**.
3. Select the **API Channel** tile.
4. Enter an Inbox Name (e.g., `Telnyx SMS`).
5. Set the **Webhook URL** to your Cloudflare Worker outbound route:
   `https://<your-worker-subdomain>.workers.dev/webhooks/chatwoot`
6. Assign agents to the inbox and click **Finish**.
7. Under Inbox Settings → **Configuration**:
   * Set **Conversation Routing** to: **"Reopen same conversation"** *(prevents creating duplicate tickets for each text)*.
   * Leave **User Identity Validation (HMAC)** toggled **OFF** / disabled.
8. Note down your **Account ID** and **Inbox ID**.

### Step 2: Configure Telnyx

1. Log in to the [Telnyx Mission Control Portal](https://portal.telnyx.com/).
2. **Messaging Profile:**
   * Go to **Messaging** → **Add Messaging Profile**.
   * Name it (e.g., `Chatwoot SMS`).
   * Set **Inbound Webhook URL** to:
     `https://<your-worker-subdomain>.workers.dev/webhooks/telnyx`
   * Ensure the API Version is set to **API v2**.
3. **Assign Phone Number:**
   * Go to **Numbers** → **My Numbers**.
   * Select your phone number and assign it to your new Messaging Profile.
4. **API Key:**
   * Click your profile icon → **Account Settings** → **API Keys**.
   * Click **Create API Key** and store the generated `KEY...` token securely.

### Step 3: Deploy the Cloudflare Worker

Choose whichever setup method feels easiest for you:

#### Option A: Quick CLI Deployment (Wrangler)

If you prefer deploying from your command line:

1. **Clone the repo:**

   ```bash
   git clone https://github.com/wildernessfamily/telnyx-chatwoot-integration-bridge.git
   cd telnyx-chatwoot-integration-bridge
   ```

2. **Install dependencies:**

   ```bash
   npm install
   ```

3. **Add secret environment variables:**

   ```bash
   npx wrangler secret put TELNYX_API_KEY
   npx wrangler secret put CHATWOOT_API_TOKEN
   ```

4. **Deploy:**

   ```bash
   npx wrangler deploy
   ```

---

#### Option B: Dashboard Web UI Setup

If you prefer using Cloudflare's web dashboard directly without a local environment:

1. Log in to the [Cloudflare Dashboard](https://dash.cloudflare.com/) → **Workers & Pages**.
2. Click **Create Application** → **Create Worker**. Name it `telnyx-chatwoot-relay` and click **Deploy**.
3. Click **Edit code** and paste the plain JavaScript code from `src/worker.js` (or section 5 below) into the editor.
4. Click **Save and Deploy**.
5. Go to **Settings** → **Variables and Secrets** on your Worker page.
6. Add the 6 environment variables listed in the table above (encrypt sensitive API keys/tokens like `TELNYX_API_KEY` and `CHATWOOT_API_TOKEN`).
7. Click **Deploy** to save your secrets.

---

## Complete Worker Code (`worker.js`)

See [worker.js](worker.js), drop-in plain JavaScript Service Worker implementation. It handles routing, contact search/creation, conversation thread matching, native MMS attachments, and typing event suppression:

---

## Testing the Integration

### 1. Inbound SMS/MMS Test

* Text your Telnyx phone number from a mobile phone (send text and an image/GIF).

* Check Chatwoot: A new conversation will open, displaying the text and image natively in the timeline.

### 2. Outbound Reply Test

* Open the conversation in Chatwoot, type a response, and click **Send**.

* Check your mobile phone for receipt.

### 3. Simulated cURL Inbound Test

Use the interactive scripts in the `scripts/` folder instead of manually crafting cURL payloads.

Available test scripts:

* `scripts/sms_2fa_code_test.sh`
  * Sends a sample inbound SMS payload (verification-code style) to `/webhooks/telnyx`.
  * Prompts for your Worker project name and domain before running.
* `scripts/mock_test.sh`
  * Sends a fuller mock inbound payload (with `from`, `to`, IDs, and text).
  * Prompts for your Worker project name, domain, and your Telnyx phone number (including international code with `+`).

Make both scripts executable:

```bash
chmod +x scripts/sms_2fa_code_test.sh scripts/mock_test.sh
```

Run either script:

```bash
./scripts/sms_2fa_code_test.sh
./scripts/mock_test.sh
```

Each script is interactive. Follow the on-screen prompts to:

* Confirm or override your Cloudflare Worker project name.
* Enter your Cloudflare Workers domain.
* (For mock test) Enter your Telnyx international code (must start with `+`) and local number.
* Confirm before sending the test request.

After submission, the script prints a styled result block with HTTP status and response body. A successful run will typically include `Inbound processed`.

---

## Carrier Compliance & 10DLC Regulations

### What is A2P 10DLC?

US carriers (Verizon, AT&T, T-Mobile) classify any message sent from software/APIs (like Chatwoot relaying through Telnyx) as **Application-to-Person (A2P)** messaging, requiring registration with **The Campaign Registry (TCR)**.

### Troubleshooting Error Code `40010`

If outbound replies fail and Telnyx logs return `errors: ["40010"]` with `"10dlc_registered": false`, Verizon/AT&T/T-Mobile are blocking the message because the sending local number lacks an approved 10DLC campaign registration.

### Cost Structure (Local US Numbers)

* **One-Time Registration Fees (First Month):**
  * Brand Registration: **$4.00**
  * Campaign Review Fee: **$15.00**
  * **Total One-Time Startup:** **$19.00**
* **Ongoing Monthly Costs (~1,500 messages/month):**
  * Local DID Line Rental: **$1.00 / mo**
  * Low-Volume Mixed 10DLC Campaign: **$1.50 / mo**
  * Telnyx Outbound SMS (~$0.0040/part): **$6.00 / mo**
  * Carrier Passthrough Surcharges (~$0.0035/part avg): **$5.25 / mo**
  * **Estimated Total:** **~$13.75 / month**
* **Idle Cost (0 messages sent):** **$2.50 / month** ($1.00 line rental + $1.50 TCR campaign maintenance).

### Alternative: Toll-Free Verification (TFV)

If you prefer to avoid TCR campaign registration fees:

* Purchase a standard Toll-Free number (888, 877, 855, etc.) for **$1.00 / month**.
* Submit **Toll-Free Verification (TFV)** inside Telnyx (**$0 setup, $0 monthly campaign fees**).
* Requires providing a government **EIN** (or SSN for Sole Proprietors) and opt-in workflow descriptions.

---

## Troubleshooting & FAQs

* **Duplicate Ticket Creation:** Ensure Chatwoot Inbox Settings → Conversation Routing is set to **"Reopen same conversation"**.
* **Blank Payloads / 422 Errors:** Ensured by event filtering in the Worker (`body.event === 'message_created'`), which ignores typing indicators (`conversation_typing_on`/`off`).
* **Internal Notes Leaking:** Handled automatically by checking `isPrivate === true` and returning `200 Ignored`.

**Copyright 2026 David Swanson | <https://david.zone>**
