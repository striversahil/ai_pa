import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import qrcode from 'qrcode-terminal';

// Initialize the client with LocalAuth to persist the session
const client = new Client({
    authStrategy: new LocalAuth({
        dataPath: './.wwebjs_auth' // Stores session details locally
    }),
    webVersionCache: {
        type: 'remote',
        remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html'
    },
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu',
            '--disable-service-workers',
            '--disable-features=ServiceWorker',
            '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
        ],
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    }
});

// --- Global caching and thread grouping structures ---
const messageCache = new Map();
const MAX_CACHE_SIZE = 1000;

// Track the last non-reply message per chat for time-proximity grouping
const chatLastMessages = new Map();
const TIME_THRESHOLD_MS = 90 * 1000; // 90 seconds

/**
 * Caches a message payload while keeping the cache under the size limit
 */
function cacheMessage(messageId, data) {
    messageCache.set(messageId, data);
    if (messageCache.size > MAX_CACHE_SIZE) {
        const oldestKey = messageCache.keys().next().value;
        messageCache.delete(oldestKey);
    }
}

/**
 * Returns all messages/media belonging to a specific logical group in chronological order
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
                media: cachedMsg.media
            });
        }
    }
    return groupMessages.sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * Priority-based resolver for a message's logicalGroupId
 */
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

    // RULE 2: Time-Proximity Grouping (Only if NOT a reply/tag, same sender & sent within 90s, inherit group)
    if (!isReply) {
        const lastMsgInfo = chatLastMessages.get(chatId);
        if (lastMsgInfo && 
            lastMsgInfo.sender === sender && 
            (currentTimestampMs - lastMsgInfo.timestamp) <= TIME_THRESHOLD_MS) {
            
            console.log(` └── 👥 Clubbed with previous message under group: ${lastMsgInfo.logicalGroupId}`);
            return lastMsgInfo.logicalGroupId;
        }
    }

    // RULE 3: Fallback (Start a brand-new group)
    const newGroupId = msg.id._serialized || msg.id.id;
    console.log(` └── 🆕 Started new Logical Group: ${newGroupId}`);
    return newGroupId;
}

/**
 * Helper to simulate human-like typing delays (randomized)
 */
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function getRandomTypingDelay(min = 50, max = 150) {
    return Math.floor(Math.random() * (max - min + 1) + min);
}

/**
 * Sends a message via the official whatsapp-web.js API as a reliable fallback
 */
async function sendFallbackMessage(client, contactSearchTerm, messageText) {
    console.log(`[Fallback] Attempting to send message via official API to: "${contactSearchTerm}"...`);
    
    // 1. Check if contactSearchTerm is a phone number (only digits, spaces, plus, hyphens)
    const cleanNumber = contactSearchTerm.replace(/[\s+-]/g, '');
    const isPhoneNumber = /^\d+$/.test(cleanNumber);
    
    if (isPhoneNumber) {
        const chatId = cleanNumber.includes('@') ? cleanNumber : `${cleanNumber}@c.us`;
        await client.sendMessage(chatId, messageText);
        console.log(`[Fallback] Message sent successfully via official API to phone number: ${chatId}`);
        return;
    }

    // 2. Try to find a matching active chat by name
    try {
        const chats = await client.getChats();
        const chat = chats.find(c => c.name && c.name.toLowerCase() === contactSearchTerm.toLowerCase());
        if (chat) {
            await client.sendMessage(chat.id._serialized, messageText);
            console.log(`[Fallback] Message sent successfully via official API to chat name: "${chat.name}"`);
            return;
        }
    } catch (e) {
        console.warn(`[Fallback] Warning finding chat by name: ${e.message}`);
    }

    // 3. Try to find a matching contact by name or pushname
    try {
        const contacts = await client.getContacts();
        const contact = contacts.find(c => 
            (c.name && c.name.toLowerCase() === contactSearchTerm.toLowerCase()) || 
            (c.pushname && c.pushname.toLowerCase() === contactSearchTerm.toLowerCase())
        );
        if (contact) {
            await client.sendMessage(contact.id._serialized, messageText);
            console.log(`[Fallback] Message sent successfully via official API to contact: "${contact.name || contact.pushname}"`);
            return;
        }
    } catch (e) {
        console.warn(`[Fallback] Warning finding contact: ${e.message}`);
    }

    throw new Error(`Could not find contact or chat matching "${contactSearchTerm}" to send fallback message.`);
}

/**
 * Sends a message by simulating human browser interactions (Clicks, Typing, Enter)
 * Falls back to direct API if simulation fails.
 */
async function sendHumanLikeMessage(client, contactSearchTerm, messageText) {
    try {
        const page = client.pupPage; // Access the Puppeteer Page object
        if (!page) {
            throw new Error("Puppeteer page is not initialized yet.");
        }

        console.log(`[Human Sim] Starting message sequence to "${contactSearchTerm}"...`);

        // 1. Locate and click the Search Box
        const searchInputSelector = 'input[placeholder="Search or start a new chat"], input[aria-label="Search or start a new chat"], [data-testid="search-input"], div[contenteditable="true"][data-tab="3"]'; 
        await page.waitForSelector(searchInputSelector, { timeout: 10000 });
        await page.click(searchInputSelector);
        await delay(500);

        // Clear search box in case something is typed
        await page.keyboard.down('Control');
        await page.keyboard.press('A');
        await page.keyboard.up('Control');
        await page.keyboard.press('Backspace');
        await delay(300);

        // 2. Type contact/number with human-like speed
        for (const char of contactSearchTerm) {
            await page.keyboard.sendCharacter(char);
            await delay(getRandomTypingDelay(80, 180));
        }
        await delay(2500); // Wait for search results to load

        // 3. Select and click the first search result
        const firstSearchResultSelector = '#pane-side div[role="row"], [data-testid="search-results"] div[role="row"]'; 
        await page.waitForSelector(firstSearchResultSelector, { timeout: 10000 });
        await page.click(firstSearchResultSelector);
        await delay(2000); // Wait for chat to open and load

        // 4. Locate and focus the Chat Message input
        const chatInputSelector = '[data-testid="conversation-compose-box-input"], div[contenteditable="true"][data-tab="10"], #main footer div[contenteditable="true"]';
        await page.waitForSelector(chatInputSelector, { timeout: 10000 });
        await page.click(chatInputSelector);
        await delay(500);

        // 5. Type the message with human-like typing delays
        console.log(`[Human Sim] Typing message...`);
        for (const char of messageText) {
            if (char === '\n') {
                await page.keyboard.down('Shift');
                await page.keyboard.press('Enter');
                await page.keyboard.up('Shift');
            } else {
                await page.keyboard.sendCharacter(char);
            }
            await delay(getRandomTypingDelay(50, 150));
        }
        await delay(1000); // Pause briefly before sending

        // 6. Hit Enter to send
        await page.keyboard.press('Enter');
        console.log(`[Human Sim] Message sent successfully to ${contactSearchTerm}!`);
        await delay(1000);

    } catch (error) {
        console.warn(`[Human Sim] Simulation failed: ${error.message}. Invoking fallback...`);
        await sendFallbackMessage(client, contactSearchTerm, messageText);
    }
}

// 1. Generate and display QR code for initial authentication
client.on('qr', (qr) => {
    console.log('\n--- SCAN THIS QR CODE WITH WHATSAPP TO LOG IN ---');
    qrcode.generate(qr, { small: true });
});

// 2. Log when authentication succeeds and trace page state
client.on('authenticated', () => {
    console.log('\nAuthentication successful! Syncing session...');
});

// 2b. Log Loading progress
client.on('loading_screen', (percent, message) => {
    console.log(`Loading Screen: ${percent}% - ${message}`);
});

// 2c. Log Connection State Changes
client.on('change_state', (state) => {
    console.log(`Connection State: ${state}`);
});

// 2d. Log Authentication Failures
client.on('auth_failure', (message) => {
    console.error(`Authentication Failure: ${message}`);
});

// 2e. Log Disconnections
client.on('disconnected', (reason) => {
    console.log(`Client was disconnected: ${reason}`);
});

// 3. Log when the client is fully ready and send a test message
client.on('ready', async () => {
    console.log('\nWhatsApp Web client is ready to receive messages!');
    
    // Diagnostic delay
    await new Promise(r => setTimeout(r, 5000));
    try {
        console.log("Analyzing page elements...");
        await client.pupPage.screenshot({ path: 'whatsapp-debug.png' });
        console.log("Screenshot saved to whatsapp-debug.png");

        const pageInfo = await client.pupPage.evaluate(() => {
            return {
                inputs: Array.from(document.querySelectorAll('input, textarea, [contenteditable]')).map(el => ({
                    tag: el.tagName,
                    id: el.id,
                    className: el.className,
                    placeholder: el.getAttribute('placeholder') || el.placeholder,
                    contenteditable: el.getAttribute('contenteditable'),
                    role: el.getAttribute('role'),
                    ariaLabel: el.getAttribute('aria-label')
                }))
            };
        });
        console.log("Page inputs:", JSON.stringify(pageInfo.inputs, null, 2));

        const divs = await client.pupPage.evaluate(() => {
            const list = Array.from(document.querySelectorAll('div[contenteditable="true"]'));
            return list.map(el => ({
                tag: el.tagName,
                dataTab: el.getAttribute('data-tab'),
                role: el.getAttribute('role'),
                parent: el.parentElement ? el.parentElement.tagName + '.' + el.parentElement.className : 'none',
                ancestors: el.closest('#side') ? 'in side' : 'not in side'
            }));
        });
        console.log("Editable Divs:", JSON.stringify(divs, null, 2));
    } catch (e) {
        console.error("Analysis failed:", e.message);
    }

    // Send "Hello sir" to 918595563952 using Puppeteer human simulation
    try {
        const targetNumber = '918595563952';
        await sendHumanLikeMessage(client, targetNumber, 'Hello sir');
    } catch (error) {
        console.error('Failed to send test message:', error.message);
    }
});

// 4. Message Handler (captures both incoming and outgoing messages and forwards them to a webhook)
client.on('message_create', async (msg) => {
    const direction = msg.fromMe ? 'OUTGOING' : 'INCOMING';
    const sender = msg.author || msg.from;
    console.log(`\n[${direction}] Processing message from [${sender}]: ${msg.body || '[Media/System Message]'}`);

    // 1. Fetch Chat details
    let isGroup = false;
    let groupName = null;
    let chat = null;
    try {
        chat = await msg.getChat();
        isGroup = chat.isGroup;
        groupName = isGroup ? chat.name : null;
        if (isGroup) {
            console.log(` └── 👥 Group Chat: "${groupName}" | Sender: ${sender}`);
        }
    } catch (error) {
        console.error(" └── ⚠️ Failed to fetch chat details:", error.message);
    }

    // 2. Fetch Contact details to check for Saved Contact Name
    let senderName = null;
    let senderPushname = null;
    try {
        const contact = await msg.getContact();
        senderName = contact.name || null;
        senderPushname = contact.pushname || null;
        if (senderName) {
            console.log(` └── 👤 Saved Sender Name: "${senderName}"`);
        }
    } catch (error) {
        console.error(" └── ⚠️ Failed to fetch contact info:", error.message);
    }

    // 3. Fetch Recipient Contact details to check for Saved Recipient Name
    let recipientName = null;
    let recipientPushname = null;
    try {
        const recipientContact = await client.getContactById(msg.to);
        recipientName = recipientContact.name || null;
        recipientPushname = recipientContact.pushname || null;
        if (recipientName) {
            console.log(` └── 👤 Saved Recipient Name: "${recipientName}"`);
        }
    } catch (error) {
        console.error(" └── ⚠️ Failed to fetch recipient contact info:", error.message);
    }

    // 4. Handle quoted messages (replies)
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
                console.log(` └── 💬 Replying to user: ${quotedMsg.from}`);
                console.log(` └── 💬 Original Message Content: ${quotedMsg.body}`);
            }
        } catch (error) {
            console.error(" └── ⚠️ Failed to fetch quoted message:", error.message);
        }
    }

    // 5. Handle media payloads
    let mediaPayload = null;
    if (msg.hasMedia) {
        try {
            console.log(" └── 📁 Downloading media...");
            const media = await msg.downloadMedia();
            if (media) {
                mediaPayload = {
                    mimetype: media.mimetype,
                    filename: media.filename || 'media',
                    data: media.data // Base64 data string
                };
                console.log(` └── 📁 Media downloaded successfully (${media.mimetype})`);
            }
        } catch (error) {
            console.error(" └── ⚠️ Failed to download media:", error.message);
        }
    }

    // 6. Resolve the Logical Group ID
    let logicalGroupId = null;
    if (chat) {
        logicalGroupId = await resolveLogicalGroupId(msg, hasQuotedMsg, quotedMsgId, sender, chat);
    } else {
        logicalGroupId = msg.id._serialized || msg.id.id;
    }

    // 7. Build the message payload
    const messagePayload = {
        messageId: msg.id._serialized || msg.id.id,
        logicalGroupId: logicalGroupId,
        from: msg.from,
        to: msg.to,
        author: msg.author || null,
        isGroup: isGroup,
        groupName: groupName,
        senderName: senderName,
        senderPushname: senderPushname,
        recipientName: recipientName,
        recipientPushname: recipientPushname,
        body: msg.body,
        timestamp: msg.timestamp * 1000, // standardizing to ms
        fromMe: msg.fromMe,
        hasMedia: msg.hasMedia,
        hasQuotedMsg: hasQuotedMsg,
        media: mediaPayload,
        quotedMessage: quotedPayload
    };

    // 8. Store the message in cache
    cacheMessage(messagePayload.messageId, messagePayload);

    // 9. Update the last message tracker for time-proximity checking (only if it is not a reply/tag)
    if (chat && !hasQuotedMsg) {
        chatLastMessages.set(chat.id._serialized, {
            messageId: messagePayload.messageId,
            sender: sender,
            timestamp: messagePayload.timestamp,
            logicalGroupId: logicalGroupId
        });
    }

    // 10. Fetch all messages/media grouped under the same Logical Group
    const groupContext = getLogicalGroupMessages(logicalGroupId);

    // 11. Construct the final webhook payload
    const webhookPayload = {
        currentMessage: messagePayload,
        logicalGroupId: logicalGroupId,
        groupContext: groupContext, // List of all combined messages & photos in this enquiry topic
        totalGroupMessages: groupContext.length
    };

    // 12. Post payload to the endpoint
    const webhookUrl = 'http://localhost:3000/api/whatsapp/webhook';
    try {
        console.log(` └── 🚀 Sending payload to ${webhookUrl}...`);
        const response = await fetch(webhookUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(webhookPayload)
        });
        
        console.log(` └── ✅ Webhook delivered. Response status: ${response.status}. Group size: ${groupContext.length}`);
    } catch (error) {
        console.error(` └── ❌ Webhook delivery failed: ${error.message}`);
    }
});

// Start the client
client.initialize();

// Clean shutdown handler to destroy client and close browser gracefully on Ctrl+C (SIGINT/SIGTERM)
async function shutdown() {
    console.log('\n[Shutting down] Gracefully destroying WhatsApp client browser instance...');
    try {
        await client.destroy();
        console.log('[Shutdown Success] Puppeteer browser closed successfully. Exiting.');
        process.exit(0);
    } catch (e) {
        console.error('[Shutdown Error] Failed to destroy client browser:', e.message);
        process.exit(1);
    }
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
