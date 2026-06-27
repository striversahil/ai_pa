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

// 3. Log when the client is fully ready
client.on('ready', () => {
    console.log('\nWhatsApp Web client is ready to receive messages!');
});

// 4. Message Handler (captures both incoming and outgoing messages and forwards them to a webhook)
client.on('message_create', async (msg) => {
    const direction = msg.fromMe ? 'OUTGOING' : 'INCOMING';
    console.log(`\n[${direction}] Processing message from [${msg.from}]: ${msg.body || '[Media/System Message]'}`);

    // Fetch Chat details to check for Group Name
    let isGroup = false;
    let groupName = null;
    try {
        const chat = await msg.getChat();
        isGroup = chat.isGroup;
        groupName = isGroup ? chat.name : null;
        if (isGroup) {
            console.log(` └── 👥 Group Chat: "${groupName}" | Sender: ${msg.author || msg.from}`);
        }
    } catch (error) {
        console.error(" └── ⚠️ Failed to fetch chat details:", error.message);
    }

    // Fetch Contact details to check for Saved Contact Name
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

    // Fetch Recipient Contact details to check for Saved Recipient Name
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

    // Build the webhook payload
    const payload = {
        messageId: msg.id._serialized || msg.id.id,
        from: msg.from,
        to: msg.to,
        author: msg.author || null, // Sender participant ID if inside a group chat
        isGroup: isGroup,
        groupName: groupName,
        senderName: senderName, // Saved name of the sender in your phone (null if not saved)
        senderPushname: senderPushname, // WhatsApp public profile name of the sender
        recipientName: recipientName, // Saved name of the recipient in your phone (null if not saved)
        recipientPushname: recipientPushname, // WhatsApp public profile name of the recipient
        body: msg.body,
        timestamp: msg.timestamp,
        fromMe: msg.fromMe,
        hasMedia: msg.hasMedia,
        hasQuotedMsg: msg.hasQuotedMsg,
        media: null,
        quotedMessage: null
    };

    // 1. Handle quoted messages (replies)
    if (msg.hasQuotedMsg) {
        try {
            const quotedMsg = await msg.getQuotedMessage();
            if (quotedMsg) {
                payload.quotedMessage = {
                    messageId: quotedMsg.id._serialized || quotedMsg.id.id,
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

    // 2. Handle media payloads
    if (msg.hasMedia) {
        try {
            console.log(" └── 📁 Downloading media...");
            const media = await msg.downloadMedia();
            if (media) {
                payload.media = {
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

    // 3. Post payload to the example endpoint
    const webhookUrl = 'https://agent.apotza.com/webhook-test/07c95cd2-c9cd-4a74-a9ac-3d658a09c8a3'; // Replace with your real API endpoint
    try {
        console.log(` └── 🚀 Sending payload to ${webhookUrl}...`);
        const response = await fetch(webhookUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });
        
        console.log(` └── ✅ Webhook delivered. Response status: ${response.status}`);
    } catch (error) {
        // Log webhook connection errors gracefully
        console.error(` └── ❌ Webhook delivery failed: ${error.message}`);
    }
});

// Start the client
client.initialize();
