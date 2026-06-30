# Enquiry Thread Tracking System

This document outlines the walkthrough and code logic to prevent nested group messages and references from getting lost on WhatsApp. It details how we group fast-succession messages (like a text followed immediately by a photo) into a single **Logical Group**, and how we propagate this relationship down the reply chain so that the entire context is preserved.

---

## 1. Architectural Strategy

### A. Logical Grouping (Time-Proximity)
When users send an enquiry, they often send a text message first, followed immediately by an image/document or vice-versa. 
* **Rule**: If a message comes from the same sender in the same chat within a **90-second threshold**, it is clubbed into the same `logicalGroupId`.

### B. Thread Inheritance (Deep Tagging)
When someone replies to/tags any message in the group, they are discussing that specific enquiry topic.
* **Rule**: If a message quotes another message, it looks up the quoted message in the cache and **inherits** its `logicalGroupId`. This ensures that even if someone replies to the photo instead of the text (or replies to a reply), it remains nested under the same main enquiry group.

```
[Lisa, 14:14] Msg A: "Need pricing for this item" ──► starts Group "MsgA"
[Lisa, 14:15] Msg B: [Photo of Item] ───────────────► same sender & <90s -> Group "MsgA" (Clubbed!)
[Moday, 14:20] Msg C: "How many do you need?" ──────► replies to Msg B -> inherits Group "MsgA"
[Lisa, 14:21] Msg D: "Around 50 units" ─────────────► replies to Msg C -> inherits Group "MsgA"
```

---

## 2. Code Implementation

Below is the JavaScript logic to be integrated into [whatsapp-bot.js](file:///home/sahildev/development/ai_pa/whatsapp_receiver/whatsapp-bot.js).

### A. The Message Cache and Grouping Logic

```javascript
// In-memory cache to store the last 1000 messages and their group relationships
const messageCache = new Map();
const MAX_CACHE_SIZE = 1000;

// Track the last message sent in each chat to handle time-proximity grouping
const chatLastMessages = new Map(); 
const TIME_THRESHOLD_MS = 90 * 1000; // 90 seconds

/**
 * Stores a message in the cache, keeping size under MAX_CACHE_SIZE
 */
function cacheMessage(messageId, data) {
    messageCache.set(messageId, data);
    if (messageCache.size > MAX_CACHE_SIZE) {
        const oldestKey = messageCache.keys().next().value;
        messageCache.delete(oldestKey);
    }
}

/**
 * Retrieves all messages belonging to a specific Logical Group.
 * This is crucial for sending the entire main message + photo context to the webhook.
 */
function getLogicalGroupMessages(logicalGroupId) {
    const groupMessages = [];
    for (const [msgId, cachedMsg] of messageCache.entries()) {
        if (cachedMsg.logicalGroupId === logicalGroupId) {
            groupMessages.push({
                messageId: cachedMsg.messageId,
                sender: cachedMsg.sender,
                senderName: cachedMsg.senderName,
                body: cachedMsg.body,
                timestamp: cachedMsg.timestamp,
                hasMedia: cachedMsg.hasMedia,
                media: cachedMsg.media // Base64 media data
            });
        }
    }
    // Sort chronologically
    return groupMessages.sort((a, b) => a.timestamp - b.timestamp);
}
```

### B. Determining the Logical Group ID

This function applies our priority rules to resolve which logical group a message belongs to:

```javascript
async function resolveLogicalGroupId(msg, isReply, quotedMsgId, sender, chat) {
    const chatId = chat.id._serialized;
    const currentTimestampMs = msg.timestamp * 1000;

    // RULE 1: Thread Inheritance (If it is a reply/tag, inherit the parent's group)
    if (isReply && quotedMsgId) {
        const cachedParent = messageCache.get(quotedMsgId);
        if (cachedParent && cachedParent.logicalGroupId) {
            console.log(` └── 🔗 Inherited Logical Group ID from quoted message: ${cachedParent.logicalGroupId}`);
            return cachedParent.logicalGroupId;
        }
    }

    // RULE 2: Time-Proximity Grouping (If same sender & sent within 90s, inherit group)
    const lastMsgInfo = chatLastMessages.get(chatId);
    if (lastMsgInfo && 
        lastMsgInfo.sender === sender && 
        (currentTimestampMs - lastMsgInfo.timestamp) <= TIME_THRESHOLD_MS) {
        
        console.log(` └── 👥 Clubbed with previous message under group: ${lastMsgInfo.logicalGroupId}`);
        return lastMsgInfo.logicalGroupId;
    }

    // RULE 3: Fallback (Start a brand-new group)
    const newGroupId = msg.id._serialized || msg.id.id;
    console.log(` └── 🆕 Started new Logical Group: ${newGroupId}`);
    return newGroupId;
}
```

### C. Integrating with the Webhook Handler

We update the `message_create` event listener in [whatsapp-bot.js](file:///home/sahildev/development/ai_pa/whatsapp_receiver/whatsapp-bot.js) to resolve the group, cache the message, and compile the full thread context for the webhook.

```javascript
client.on('message_create', async (msg) => {
    const direction = msg.fromMe ? 'OUTGOING' : 'INCOMING';
    const sender = msg.author || msg.from;
    console.log(`\n[${direction}] Processing message from [${sender}]: ${msg.body || '[Media]'}`);

    // 1. Get Chat details
    let isGroup = false;
    let groupName = null;
    let chat = null;
    try {
        chat = await msg.getChat();
        isGroup = chat.isGroup;
        groupName = isGroup ? chat.name : null;
    } catch (e) {
        console.error("Failed to get chat info:", e.message);
    }

    // 2. Get Contact details
    let senderName = null;
    try {
        const contact = await msg.getContact();
        senderName = contact.name || contact.pushname || null;
    } catch (e) {
        console.error("Failed to get contact info:", e.message);
    }

    // 3. Resolve quoted/reply info
    const hasQuotedMsg = msg.hasQuotedMsg;
    let quotedMsgId = null;
    let quotedPayload = null;

    if (hasQuotedMsg) {
        try {
            const quotedMsg = await msg.getQuotedMessage();
            if (quotedMsg) {
                quotedMsgId = quotedMsg.id._serialized || quotedMsg.id.id;
                quotedPayload = {
                    messageId: quotedMsgId,
                    from: quotedMsg.from,
                    body: quotedMsg.body,
                    hasMedia: quotedMsg.hasMedia
                };
            }
        } catch (e) {
            console.error("Failed to get quoted message:", e.message);
        }
    }

    // 4. Download media if present
    let mediaPayload = null;
    if (msg.hasMedia) {
        try {
            const media = await msg.downloadMedia();
            if (media) {
                mediaPayload = {
                    mimetype: media.mimetype,
                    filename: media.filename || 'media',
                    data: media.data
                };
            }
        } catch (e) {
            console.error("Failed to download media:", e.message);
        }
    }

    // 5. Resolve the Logical Group ID
    const logicalGroupId = await resolveLogicalGroupId(msg, hasQuotedMsg, quotedMsgId, sender, chat);

    // 6. Build the base message payload
    const messagePayload = {
        messageId: msg.id._serialized || msg.id.id,
        logicalGroupId: logicalGroupId,
        from: msg.from,
        to: msg.to,
        sender: sender,
        senderName: senderName,
        body: msg.body,
        timestamp: msg.timestamp * 1000,
        isGroup: isGroup,
        groupName: groupName,
        hasMedia: msg.hasMedia,
        media: mediaPayload,
        quotedMessage: quotedPayload
    };

    // 7. Store the message in cache
    cacheMessage(messagePayload.messageId, messagePayload);

    // 8. Update the last message tracker for time-proximity checking
    chatLastMessages.set(chat.id._serialized, {
        messageId: messagePayload.messageId,
        sender: sender,
        timestamp: messagePayload.timestamp,
        logicalGroupId: logicalGroupId
    });

    // 9. Fetch all messages/media grouped under the same Logical Group
    const groupContext = getLogicalGroupMessages(logicalGroupId);

    // 10. Construct the final webhook payload
    const webhookPayload = {
        currentMessage: messagePayload,
        logicalGroupId: logicalGroupId,
        groupContext: groupContext, // List of all combined messages & photos in this enquiry topic
        totalGroupMessages: groupContext.length
    };

    // 11. Send payload to Webhook
    const webhookUrl = 'https://agent.apotza.com/webhook-test/07c95cd2-c9cd-4a74-a9ac-3d658a09c8a3';
    try {
        await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(webhookPayload)
        });
        console.log(` └── ✅ Webhook delivered. Messages in active group context: ${groupContext.length}`);
    } catch (error) {
        console.error(` └── ❌ Webhook delivery failed: ${error.message}`);
    }
});
```

---

## 3. Webhook Payload Structure

When a reply (such as *"Yes, looks delicious!"*) is sent, the backend receives the following JSON payload. Notice that it contains the `groupContext` detailing both the initial enquiry message, the photo (in Base64), and any intermediate replies:

```json
{
  "logicalGroupId": "true_1203632948293@g.us_3EB0C34B8C1D431F909A",
  "currentMessage": {
    "messageId": "true_1203632948293@g.us_3EB0D45C9D2E542G102B",
    "logicalGroupId": "true_1203632948293@g.us_3EB0C34B8C1D431F909A",
    "from": "1203632948293@g.us",
    "sender": "123456789@c.us",
    "senderName": "Sara",
    "body": "Yes, looks delicious!",
    "timestamp": 1782742920000,
    "isGroup": true,
    "groupName": "Cake Orders & Delivery"
  },
  "groupContext": [
    {
      "messageId": "true_1203632948293@g.us_3EB0C34B8C1D431F909A",
      "sender": "987654321@c.us",
      "senderName": "Lisa",
      "body": "Need pricing for this item",
      "timestamp": 1782742440000,
      "hasMedia": false
    },
    {
      "messageId": "true_1203632948293@g.us_3EB0C34B8C1D432A912F",
      "sender": "987654321@c.us",
      "senderName": "Lisa",
      "body": "",
      "timestamp": 1782742500000,
      "hasMedia": true,
      "media": {
        "mimetype": "image/jpeg",
        "filename": "cake.jpeg",
        "data": "iVBORw0KGgoAAAANSU..."
      }
    },
    {
      "messageId": "true_1203632948293@g.us_3EB0D34B8C1D432F908B",
      "sender": "111222333@c.us",
      "senderName": "Moday",
      "body": "How many do you need?",
      "timestamp": 1782742800000,
      "hasMedia": false
    },
    {
      "messageId": "true_1203632948293@g.us_3EB0D45C9D2E542G102B",
      "sender": "123456789@c.us",
      "senderName": "Sara",
      "body": "Yes, looks delicious!",
      "timestamp": 1782742920000,
      "hasMedia": false
    }
  ],
  "totalGroupMessages": 4
}
```

---

## 4. Key Benefits of This Strategy

1. **Context Preserved**: The webhook receives the **entire group context** with every message event. The backend does not need to query database APIs repeatedly to reconstruct the tree; it receives the complete thread context in one payload.
2. **Zero Orphaned Media**: If a user tags the photo, the backend can resolve the text that was sent right before/after it because they share the same `logicalGroupId`.
3. **No Fragmentation**: Discussions around the enquiry are bound to the original message's thread context indefinitely.
