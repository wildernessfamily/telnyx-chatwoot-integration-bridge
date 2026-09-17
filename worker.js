/*
 * Copyright (c) 2026 David Swanson https://david.zone
 * This software is licensed under CC BY-NC-SA 4.0
 * http://creativecommons.org/licenses/by-nc-sa/4.0/
*/

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
  const url = new URL(request.url);

  // Read environment variables directly from global scope
  const TELNYX_API_KEY = globalThis.TELNYX_API_KEY;
  const CHATWOOT_API_TOKEN = globalThis.CHATWOOT_API_TOKEN;
  const CHATWOOT_BASE_URL = globalThis.CHATWOOT_BASE_URL;
  const CHATWOOT_ACCOUNT_ID = globalThis.CHATWOOT_ACCOUNT_ID;
  const CHATWOOT_INBOX_ID = globalThis.CHATWOOT_INBOX_ID;
  const TELNYX_PHONE_NUMBER = globalThis.TELNYX_PHONE_NUMBER;

  // ==========================================
  // Endpoint A: Telnyx -> Chatwoot (Inbound SMS/MMS)
  // ==========================================
  if (url.pathname === '/webhooks/telnyx' && request.method === 'POST') {
    try {
      const body = await request.json();
      const eventType = body?.data?.event_type;

      // Ignore delivery receipts or non-message events
      if (eventType !== 'message.received') {
        return new Response('Event ignored', { status: 200 });
      }

      const payload = body?.data?.payload;
      const senderPhone = payload?.from?.phone_number;
      const messageText = payload?.text || '';
      const media = payload?.media || [];

      if (!senderPhone) {
        return new Response('Missing sender phone', { status: 400 });
      }

      const headers = {
        'api_access_token': CHATWOOT_API_TOKEN,
        'Content-Type': 'application/json',
      };

      // 1. Search or create contact in Chatwoot
      let contactId = null;
      const searchRes = await fetch(
        `${CHATWOOT_BASE_URL}/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/contacts/search?q=${encodeURIComponent(senderPhone)}`,
        { headers }
      );
      const searchData = await searchRes.json();

      if (searchData?.payload?.length > 0) {
        contactId = searchData.payload[0].id;
      } else {
        const createContactRes = await fetch(
          `${CHATWOOT_BASE_URL}/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/contacts`,
          {
            method: 'POST',
            headers,
            body: JSON.stringify({
              name: senderPhone,
              phone_number: senderPhone,
            }),
          }
        );
        const createContactData = await createContactRes.json();
        contactId = createContactData?.payload?.contact?.id;
      }

      if (!contactId) {
        return new Response('Unable to resolve contact', { status: 500 });
      }

      // 2. Look for an existing active conversation for this contact in the inbox
      let conversationId = null;
      const contactConvRes = await fetch(
        `${CHATWOOT_BASE_URL}/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/contacts/${contactId}/conversations`,
        { headers }
      );

      if (contactConvRes.ok) {
        const convList = await contactConvRes.json();
        const openConv = convList?.payload?.find(
          c => String(c.inbox_id) === String(CHATWOOT_INBOX_ID) && c.status !== 'resolved'
        );
        if (openConv) {
          conversationId = openConv.id;
        }
      }

      // If no active thread exists, open a new conversation
      if (!conversationId) {
        const createConvRes = await fetch(
          `${CHATWOOT_BASE_URL}/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/conversations`,
          {
            method: 'POST',
            headers,
            body: JSON.stringify({
              contact_id: contactId,
              inbox_id: parseInt(CHATWOOT_INBOX_ID, 10),
            }),
          }
        );
        const newConvData = await createConvRes.json();
        conversationId = newConvData?.id;
      }

      if (!conversationId) {
        return new Response('Unable to resolve conversation', { status: 500 });
      }

      // 3. Post message to Chatwoot (Multipart for MMS, JSON for text)
      if (media.length > 0) {
        const mediaItem = media[0];
        const fileRes = await fetch(mediaItem.url);
        const fileBlob = await fileRes.blob();

        const formData = new FormData();
        formData.append('content', messageText || '');
        formData.append('message_type', 'incoming');
        formData.append('private', 'false');
        formData.append('attachments[]', fileBlob, 'attachment');

        await fetch(
          `${CHATWOOT_BASE_URL}/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/conversations/${conversationId}/messages`,
          {
            method: 'POST',
            headers: {
              'api_access_token': CHATWOOT_API_TOKEN,
            },
            body: formData,
          }
        );
      } else {
        await fetch(
          `${CHATWOOT_BASE_URL}/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/conversations/${conversationId}/messages`,
          {
            method: 'POST',
            headers,
            body: JSON.stringify({
              content: messageText || '[Empty message]',
              message_type: 'incoming',
              private: false,
            }),
          }
        );
      }

      return new Response('Inbound processed', { status: 200 });
    } catch (err) {
      return new Response(`Inbound error: ${err.message}`, { status: 500 });
    }
  }

  // ==========================================
  // Endpoint B: Chatwoot -> Telnyx (Outbound SMS/MMS)
  // ==========================================
  if (url.pathname === '/webhooks/chatwoot' && request.method === 'POST') {
    try {
      const body = await request.json();

      // Ignore typing indicators or non-message events
      if (body?.event && body.event !== 'message_created') {
        return new Response('Ignored non-message event: ' + body.event, { status: 200 });
      }

      // Skip internal staff notes and non-outgoing messages
      const messageType = body?.message_type;
      const isPrivate = body?.private;
      if (messageType !== 'outgoing' || isPrivate === true) {
        return new Response('Ignored non-outgoing or private message', { status: 200 });
      }

      const messageText = body?.content || body?.message?.content || '';
      const attachments = body?.attachments || body?.message?.attachments || [];

      // Skip blank dispatches
      if (!messageText && attachments.length === 0) {
        return new Response('Ignored empty message payload', { status: 200 });
      }

      // Extract recipient phone number across payload variations
      let recipientPhone =
        body?.conversation?.meta?.sender?.phone_number ||
        body?.conversation?.contact_inbox?.source_id ||
        body?.meta?.sender?.phone_number ||
        body?.sender?.phone_number ||
        body?.conversation?.contact?.phone_number;

      const convId = body?.conversation?.id || body?.conversation_id;

      if (!recipientPhone && convId) {
        const convDetailRes = await fetch(
          `${CHATWOOT_BASE_URL}/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/conversations/${convId}`,
          {
            headers: {
              'api_access_token': CHATWOOT_API_TOKEN,
              'Content-Type': 'application/json',
            },
          }
        );
        if (convDetailRes.ok) {
          const detail = await convDetailRes.json();
          recipientPhone =
            detail?.meta?.sender?.phone_number ||
            detail?.contact_inbox?.source_id ||
            detail?.sender?.phone_number;
        }
      }

      if (!recipientPhone) {
        return new Response('Recipient phone missing', { status: 400 });
      }

      const telnyxPayload = {
        from: TELNYX_PHONE_NUMBER,
        to: recipientPhone,
        text: messageText,
      };

      if (attachments.length > 0) {
        telnyxPayload.media_urls = attachments.map(a => a.data_url || a.thumb_url);
      }

      const telnyxRes = await fetch('https://api.telnyx.com/v2/messages', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${TELNYX_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(telnyxPayload),
      });

      const telnyxResponseText = await telnyxRes.text();
      return new Response(telnyxResponseText, { status: telnyxRes.status });
    } catch (err) {
      return new Response(`Outbound error: ${err.message}`, { status: 500 });
    }
  }

  return new Response('Not found', { status: 404 });
}
