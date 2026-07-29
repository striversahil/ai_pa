import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import { config } from './config';
import { logger } from './shared/logger';
import { SchedulerService } from './modules/scheduler/service';
import { WhatsAppController } from './modules/whatsapp/controller';
import { WhatsAppService } from './modules/whatsapp/service';
import { DigestService } from './modules/digest/service';
import { TasksService } from './modules/tasks/service';
import { StorageRepository } from './modules/storage/repository';
import { AIService } from './modules/ai/service';
import { EmailService } from './modules/email/service';
import { checkDatabaseConnection, useInMemoryDb, prisma } from './shared/prisma';
import { SalesCopilotService } from './modules/sales_copilot/service';
import { BrainService } from './modules/brain/service';
import { GoogleSheetsService } from './modules/google_sheets/service';
import { asyncHandler } from './utils/asyncHandler';
import { errorHandler, notFoundHandler } from './utils/errorHandler';
import { ParsedQs } from 'qs';


const app = express();

// Serve the static frontend files
app.use(express.static(path.join(__dirname, '../public')));

app.use(express.json({ limit: '10mb' })); // Support larger payloads (like media Base64 from WhatsApp)

// Request logger middleware
app.use((req, res, next) => {
  logger.info({ method: req.method, url: req.url }, 'Incoming API Request');
  next();
});

// --- WhatsApp webhook endpoint ---
app.post('/api/whatsapp/webhook', asyncHandler(WhatsAppController.handleWebhook));

// --- REST API Endpoints ---

/**
 * GET /api/status
 * Returns connection diagnostic status (Supabase active / LLM API key status)
 */
app.get('/api/status', asyncHandler(async (req, res) => {
  const isMockLLM = !config.LLM_API_KEY || config.LLM_API_KEY === 'your_api_key_here';
  res.status(200).json({
    success: true,
    useInMemoryDb,
    isMockLLM,
  });
}));

/**
 * GET /api/brief/latest
 * Retrieve the latest generated founder briefing or EOD summary
 */
app.get('/api/brief/latest', asyncHandler(async (req, res) => {
  const brief = await StorageRepository.fetchLatestFounderNote();
  if (!brief) {
    res.status(404).json({ error: 'No briefings found.' });
    return;
  }
  res.status(200).json(brief);
}));

/**
 * GET /api/digests
 * Fetch conversation digests
 */
app.get('/api/digests', asyncHandler(async (req, res) => {
  let digests = await DigestService.fetchAllDigests();
  if (digests.length === 0) {
    logger.info('GET /api/digests: Digests list is empty. Triggering message digests compilation...');
    await DigestService.processMessagesToDigests();
    digests = await DigestService.fetchAllDigests();
  }
  res.status(200).json(digests);
}));

/**
 * GET /api/tasks
 * Fetch extracted action items
 */
app.get('/api/tasks', asyncHandler(async (req, res) => {
  const tasks = await TasksService.fetchTasks();
  res.status(200).json(tasks);
}));

/**
 * GET /api/messages/:chatId
 * Fetch raw messages from a specific WhatsApp chat
 */
app.get('/api/messages/:chatId', asyncHandler(async (req, res) => {
  const { chatId } = req.params;
  const chatIdStr = Array.isArray(chatId) ? chatId[0] : chatId;
  const messages = await WhatsAppService.fetchMessagesByChatId(chatIdStr);
  res.status(200).json(messages);
}));

/**
 * GET /api/sheet-data
 * Fetch and parse data from a Google Sheet.
 * Query params: spreadsheetId, range
 */
app.get('/api/sheet-data', asyncHandler(async (req, res) => {
  const spreadsheetIdRaw = req.query.spreadsheetId as unknown;
  let spreadsheetId: string;
  if (Array.isArray(spreadsheetIdRaw)) {
    spreadsheetId = spreadsheetIdRaw[0] as string;
  } else if (typeof spreadsheetIdRaw === 'string') {
    spreadsheetId = spreadsheetIdRaw;
  } else if (spreadsheetIdRaw && typeof spreadsheetIdRaw === 'object') {
    spreadsheetId = '1OsQevXQpPT1x2iJgcg0lgUcOInxjZh3tvfNjxAbcENs';
  } else {
    spreadsheetId = '1OsQevXQpPT1x2iJgcg0lgUcOInxjZh3tvfNjxAbcENs';
  }
  
  const rangeRaw = req.query.range as unknown;
  let range: string;
  if (Array.isArray(rangeRaw)) {
    range = rangeRaw[0] as string;
  } else if (typeof rangeRaw === 'string') {
    range = rangeRaw;
  } else if (rangeRaw && typeof rangeRaw === 'object') {
    range = 'A1:Z1000';
  } else {
    range = 'A1:Z1000';
  }
  const data = await GoogleSheetsService.getSpreadsheetData(spreadsheetId, range);
  res.status(200).json(data);
}));

/**
 * POST /api/ask-founder-ai
 * Company Brain powered Q&A — searches all indexed company context and synthesizes an answer.
 * This is the primary chat endpoint used by the Founder Assistant UI.
 * Body: { question: string, entityFilter?: string }
 */
app.post('/api/ask-founder-ai', asyncHandler(async (req, res) => {
  let question = '';
  const { entityFilter } = req.body;
  question = req.body.question;
  if (!question) {
    res.status(400).json({ error: 'Missing question in request body' });
    return;
  }

  // Route through the Company Brain (Pillar 1) for cross-source context search
  const result = await BrainService.query(question, entityFilter);
  res.status(200).json({ question, answer: result.answer, brainMeta: {
    sourcesUsed: result.sourcesUsed,
    contextCount: result.contextCount,
  }});
}));

// --- Manual Test Trigger Endpoints ---

/**
 * POST /api/trigger/digest
 * Force trigger WhatsApp messages digestion
 */
app.post('/api/trigger/digest', asyncHandler(async (req, res) => {
  const result = await DigestService.processMessagesToDigests();
  res.status(200).json({ message: 'Digest job triggered successfully', result });
}));

/**
 * POST /api/trigger/email-sync
 * Force sync unread emails
 */
app.post('/api/trigger/email-sync', asyncHandler(async (req, res) => {
  const count = await EmailService.syncEmails();
  res.status(200).json({ message: 'Email sync job completed', emailsSynced: count });
}));

/**
 * POST /api/trigger/briefing
 * Force generate morning briefing
 */
app.post('/api/trigger/briefing', asyncHandler(async (req, res) => {
  const brief = await SchedulerService.generateAndSaveMorningBrief();
  res.status(200).json({ message: 'Morning briefing generated and saved', brief });
}));

/**
 * POST /api/trigger/summary
 * Force generate daily evening summary
 */
app.post('/api/trigger/summary', asyncHandler(async (req, res) => {
  const summary = await SchedulerService.generateAndSaveEveningSummary();
  res.status(200).json({ message: 'Evening summary generated and saved', summary });
}));

/**
 * GET /api/estimates
 * Fetches active sent estimates and classifications
 */
app.get('/api/estimates', asyncHandler(async (req, res) => {
  const estimates = await prisma.estimate.findMany({
    where: {
      OR: [
        { status: 'sent' },
        { status: 'accepted' },
        { status: 'declined' },
        { status: 'confirmed' }
      ]
    },
    include: {
      classification: true,
      comments: {
        orderBy: { commentId: 'desc' }
      }
    }
  });
  res.status(200).json(estimates);
}));

let isSalesSyncRunning = false;

/**
 * POST /api/trigger/sales-sync
 * Force sync and analyze Zoho Estimates (Sales Copilot)
 */
app.post('/api/trigger/sales-sync', asyncHandler(async (req, res) => {
  if (isSalesSyncRunning) {
    logger.warn('API: Sales sync trigger received while a job is already running. Rejecting request.');
    res.status(409).json({ error: 'Sync job is already processing. Please wait.' });
    return;
  }

  isSalesSyncRunning = true;
  try {
    const force = Array.isArray(req.query.force) 
      ? req.query.force[0] === 'true' 
      : (req.query.force as string) === 'true' || req.body?.force === true;
    const result = await new SalesCopilotService().runSync(force);
    res.status(200).json({ message: 'Sales Copilot analysis job completed', result });
  } finally {
    isSalesSyncRunning = false;
  }
}));

/**
 * POST /api/brain/query
 * The Company Brain — natural language search across all indexed company context
 * Body: { question: string, entityFilter?: string }
 */
app.post('/api/brain/query', asyncHandler(async (req, res) => {
  let question = '';
  const { entityFilter } = req.body;
  question = req.body.question;
  if (!question) {
    res.status(400).json({ error: 'Missing question in request body' });
    return;
  }
  const result = await BrainService.query(question, entityFilter);
  res.status(200).json(result);
}));

/**
 * GET /api/brain/stats
 * Returns current brain indexing statistics
 */
app.get('/api/brain/stats', asyncHandler(async (req, res) => {
  const stats = await BrainService.getStats();
  res.status(200).json(stats);
}));

/**
 * POST /api/trigger/brain-index
 * Force re-index all data sources into the Company Brain
 */
app.post('/api/trigger/brain-index', asyncHandler(async (req, res) => {
  const brain = new BrainService();
  const result = await brain.runSync();
  res.status(200).json({ message: 'Company Brain re-index complete', result });
}));

// --- WhatsApp Automation Hub API Proxy Endpoints ---

const getWaEngineConfig = (req: Request) => {
  const vendorUid = req.headers['x-wa-vendor-uid'] as string || process.env.WA_ENGINE_VENDOR_UID || 'b35c07b9-99fa-4224-a7f3-1ea587cb2e64';
  const bearerToken = req.headers['x-wa-bearer-token'] as string || process.env.WA_ENGINE_BEARER_TOKEN || 'aNxAArZ6ahSs81ogk4rZXgk1C8f7jJ66PtbkDOmlRVORWRMt0ZT9VJTA6Gmw2Ua8';
  const apiBaseUrl = 'https://plus.waengine.in/api';
  return { vendorUid, bearerToken, apiBaseUrl };
};

/**
 * GET /api/whatsapp/campaigns
 * Fetch list of WhatsApp campaigns
 */
app.get('/api/whatsapp/campaigns', asyncHandler(async (req, res) => {
  const { vendorUid, bearerToken, apiBaseUrl } = getWaEngineConfig(req);
  const url = `${apiBaseUrl}/${vendorUid}/campaigns`;
  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${bearerToken}`
    }
  });
  if (response.ok) {
    const data = await response.json();
    return res.status(200).json(data);
  }
  throw new Error(`WA Engine returned status ${response.status}`);
}));

/**
 * POST /api/whatsapp/campaigns/create
 * Trigger template campaign blasts
 */
app.post('/api/whatsapp/campaigns/create', asyncHandler(async (req, res) => {
  const { vendorUid, bearerToken, apiBaseUrl } = getWaEngineConfig(req);
  const { title, template_name, template_language, group_uid, scheduled_at } = req.body;
  const url = `${apiBaseUrl}/${vendorUid}/campaigns/create`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${bearerToken}`
    },
    body: JSON.stringify({ title, template_name, template_language, group_uid, scheduled_at })
  });
  if (response.ok) {
    const data = await response.json();
    return res.status(200).json(data);
  }
  throw new Error(`WA Engine returned status ${response.status}`);
}));

/**
 * GET /api/whatsapp/groups
 * Fetch contact groups/lists
 */
app.get('/api/whatsapp/groups', asyncHandler(async (req, res) => {
  const { vendorUid, bearerToken, apiBaseUrl } = getWaEngineConfig(req);
  const url = `${apiBaseUrl}/${vendorUid}/groups`;
  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${bearerToken}`
    }
  });
  if (response.ok) {
    const data = await response.json();
    return res.status(200).json(data);
  }
  throw new Error(`WA Engine returned status ${response.status}`);
}));

/**
 * POST /api/whatsapp/groups/create
 * Create target group segment
 */
app.post('/api/whatsapp/groups/create', asyncHandler(async (req, res) => {
  const { vendorUid, bearerToken, apiBaseUrl } = getWaEngineConfig(req);
  const { name, description } = req.body;
  const url = `${apiBaseUrl}/${vendorUid}/groups/create`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${bearerToken}`
    },
    body: JSON.stringify({ name, description })
  });
  if (response.ok) {
    const data = await response.json();
    return res.status(200).json(data);
  }
  throw new Error(`WA Engine returned status ${response.status}`);
}));

/**
 * GET /api/whatsapp/templates
 * Fetch approved template messages list
 */
app.get('/api/whatsapp/templates', asyncHandler(async (req, res) => {
  const { vendorUid, bearerToken, apiBaseUrl } = getWaEngineConfig(req);
  const url = `${apiBaseUrl}/${vendorUid}/templates`;
  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${bearerToken}`
    }
  });
  if (response.ok) {
    const data = await response.json();
    return res.status(200).json(data);
  }
  throw new Error(`WA Engine returned status ${response.status}`);
}));

/**
 * POST /api/whatsapp/send
 * Dispatches a WhatsApp text message and logs it locally
 */
app.post('/api/whatsapp/send', asyncHandler(async (req, res) => {
  const { vendorUid, bearerToken, apiBaseUrl } = getWaEngineConfig(req);
  const { phone_number, message_body } = req.body;
  if (!phone_number || !message_body) {
    return res.status(400).json({ error: 'Missing phone_number or message_body' });
  }

  // Save to database locally first so it shows up in conversation logs immediately
  await WhatsAppService.saveMessage({
    chatId: phone_number,
    sender: 'You',
    body: message_body,
    timestamp: new Date()
  });

  const url = `${apiBaseUrl}/${vendorUid}/contact/send-message`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${bearerToken}`
    },
    body: JSON.stringify({
      phone_number,
      message_body
    })
  });
  if (response.ok) {
    const data = await response.json();
    return res.status(200).json({ success: true, message: 'Message sent successfully', data });
  }
  throw new Error(`WA Engine returned status ${response.status}`);
}));

/**
 * Helper function to resolve contact name by UUID or phone number
 */
async function resolveContactName(contactUid: string, vendorUid: string, bearerToken: string, apiBaseUrl: string): Promise<string> {
  try {
    const groupsUrl = `${apiBaseUrl}/${vendorUid}/groups`;
    const groupsRes = await fetch(groupsUrl, {
      headers: {
        'Authorization': `Bearer ${bearerToken}`
      }
    });
    if (groupsRes.ok) {
      const groupsData = await groupsRes.json() as any;
      const groups = groupsData.data || [];
      for (const group of groups) {
        const contactsUrl = `${apiBaseUrl}/${vendorUid}/groups/${group.uid}/contacts`;
        const contactsRes = await fetch(contactsUrl, {
          headers: {
            'Authorization': `Bearer ${bearerToken}`
          }
        });
        if (contactsRes.ok) {
          const contactsData = await contactsRes.json() as any;
          const contacts = contactsData.data || [];
          const matched = contacts.find((c: any) => c.uid === contactUid || c.wa_id === contactUid || `${c.wa_id}@c.us` === contactUid);
          if (matched) {
            return (matched.full_name || matched.first_name || matched.wa_id || 'Client').trim();
          }
        }
      }
    }
  } catch (e: any) {}

  if (contactUid.includes('919811044521')) return 'Sanjay Singhal';
  if (contactUid.includes('918511299014')) return 'Vikram Rathore';
  if (contactUid.includes('918595563952')) return 'Sahil Kumar';
  
  return contactUid.split('@')[0];
}

/**
 * Helper function to resolve phone number or chatId to WA Engine contact UUID
 */
async function resolveContactUid(contactUid: string, vendorUid: string, bearerToken: string, apiBaseUrl: string): Promise<string> {
  // If it's already a UUID, return directly
  if (contactUid.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
    return contactUid;
  }
  
  // Extract numbers
  const phoneNumber = contactUid.replace(/[^0-9]/g, '');
  if (!phoneNumber) return contactUid;

  try {
    const url = `${apiBaseUrl}/${vendorUid}/contact/by-phone?phone_number=${phoneNumber}`;
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${bearerToken}`
      }
    });
    if (response.ok) {
      const data = await response.json() as any;
      if (data.data?.contact_uid) {
        return data.data.contact_uid;
      }
    }
  } catch (e: any) {
    logger.warn({ error: e.message, phoneNumber }, 'Failed to resolve contact UID by phone number');
  }

  return contactUid;
}

/**
 * GET /api/whatsapp/contacts
 * Fetch live contacts from WA Engine Plus
 */
app.get('/api/whatsapp/contacts', asyncHandler(async (req, res) => {
  const { vendorUid, bearerToken, apiBaseUrl } = getWaEngineConfig(req);
  
  // 1. Fetch all groups first since global /contacts returns 404
  const groupsUrl = `${apiBaseUrl}/${vendorUid}/groups`;
  const groupsRes = await fetch(groupsUrl, {
    headers: {
      'Authorization': `Bearer ${bearerToken}`
    }
  });
  
  if (groupsRes.ok) {
    const groupsData = await groupsRes.json() as any;
    const groups = groupsData.data || [];
    const allContactsMap = new Map<string, any>();
    
    // 2. Fetch contacts in each group to compile a complete de-duplicated list
    for (const group of groups) {
      try {
        const contactsUrl = `${apiBaseUrl}/${vendorUid}/groups/${group.uid}/contacts`;
        const contactsRes = await fetch(contactsUrl, {
          headers: {
            'Authorization': `Bearer ${bearerToken}`
          }
        });
        if (contactsRes.ok) {
          const contactsData = await contactsRes.json() as any;
          const contacts = contactsData.data || [];
          for (const c of contacts) {
            if (c.wa_id && !allContactsMap.has(c.wa_id)) {
              allContactsMap.set(c.wa_id, {
                uid: c.uid || `${c.wa_id}@c.us`,
                name: c.full_name || c.first_name || c.wa_id || 'Client',
                phone_number: c.wa_id,
                email: c.email || ''
              });
            }
          }
        }
      } catch (e: any) {
        logger.warn({ error: e.message, groupUid: group.uid }, 'Failed to fetch contacts for group');
      }
    }
    
    const contactsList = Array.from(allContactsMap.values());
    if (contactsList.length > 0) {
      return res.status(200).json({ contacts: contactsList });
    }
  }
  
  // Fallback: try direct contacts list
  const url = `${apiBaseUrl}/${vendorUid}/contacts?page=1&per_page=50`;
  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${bearerToken}`
    }
  });
  if (response.ok) {
    const data = await response.json();
    return res.status(200).json(data);
  }
  throw new Error(`WA Engine returned status ${response.status}`);
}));

/**
 * GET /api/whatsapp/contacts/:contactUid/messages
 * Fetch live message history from WA Engine Plus for a specific contact
 */
app.get('/api/whatsapp/contacts/:contactUid/messages', asyncHandler(async (req, res) => {
  const { vendorUid, bearerToken, apiBaseUrl } = getWaEngineConfig(req);
  const contactUidRaw = req.params.contactUid;
  const contactUidRawStr = Array.isArray(contactUidRaw) ? contactUidRaw[0] : contactUidRaw;
  
  const contactUid = await resolveContactUid(contactUidRawStr, vendorUid, bearerToken, apiBaseUrl);
  
  // Fetch local DB messages
  const localMsgs = await WhatsAppService.fetchMessagesByChatId(contactUidRawStr);
  
  // Fetch live messages from WA Engine Plus
  let cloudMsgs: any[] = [];
  try {
    const url = `${apiBaseUrl}/${vendorUid}/contacts/${contactUid}/messages?page=1&limit=50`;
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${bearerToken}`
      }
    });
    if (response.ok) {
      const data = await response.json() as any;
      cloudMsgs = (data.data || data.messages || []).map((m: any) => ({
        id: m.uid || m.id || String(Math.random()),
        chatId: contactUidRawStr,
        sender: m.direction === 'inbound' ? 'Client' : 'You',
        body: m.message_body || m.body || '',
        timestamp: m.created_at || m.timestamp || new Date().toISOString(),
        processed: true
      }));
    }
  } catch (e: any) {
    logger.warn({ error: e.message }, 'Failed to fetch cloud messages, using local only');
  }

  // Merge and de-duplicate
  const msgMap = new Map<string, any>();
  for (const m of cloudMsgs) {
    msgMap.set(m.id, m);
  }
  for (const m of localMsgs) {
    if (!msgMap.has(m.id)) {
      msgMap.set(m.id, {
        id: m.id,
        chatId: contactUidRawStr,
        sender: m.sender === 'Founder' || m.sender === 'You' ? 'You' : 'Client',
        body: m.body,
        timestamp: m.timestamp,
        processed: m.processed
      });
    }
  }

  const mergedMessages = Array.from(msgMap.values());
  mergedMessages.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  return res.status(200).json(mergedMessages);
}));

/**
 * GET /api/whatsapp/contacts/:contactUid/summarize
 * Generate a conversation summary for a specific contact
 */
app.get('/api/whatsapp/contacts/:contactUid/summarize', asyncHandler(async (req, res) => {
  const { vendorUid, bearerToken, apiBaseUrl } = getWaEngineConfig(req);
  const contactUidRaw = req.params.contactUid;
  const contactUidRawStr = Array.isArray(contactUidRaw) ? contactUidRaw[0] : contactUidRaw;

  const contactUid = await resolveContactUid(contactUidRawStr, vendorUid, bearerToken, apiBaseUrl);
  const contactName = await resolveContactName(contactUidRawStr, vendorUid, bearerToken, apiBaseUrl);
  
  // Fetch local DB messages
  const localMsgs = await WhatsAppService.fetchMessagesByChatId(contactUidRawStr);
  
  // Fetch live messages from WA Engine Plus
  let cloudMsgs: any[] = [];
  try {
    const url = `${apiBaseUrl}/${vendorUid}/contacts/${contactUid}/messages?page=1&limit=50`;
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${bearerToken}`
      }
    });
    if (response.ok) {
      const data = await response.json() as any;
      cloudMsgs = data.data || data.messages || [];
    }
  } catch (e: any) {
    logger.warn({ error: e.message }, 'Failed to fetch cloud messages for summary');
  }

  // Merge messages
  const msgMap = new Map<string, any>();
  for (const m of cloudMsgs) {
    const uid = m.uid || m.id || String(Math.random());
    msgMap.set(uid, {
      direction: m.direction,
      message_body: m.message_body || m.body || '',
      created_at: m.created_at || m.timestamp || new Date().toISOString()
    });
  }
  for (const m of localMsgs) {
    if (!msgMap.has(m.id)) {
      msgMap.set(m.id, {
        direction: m.sender === 'Founder' || m.sender === 'You' ? 'outbound' : 'inbound',
        message_body: m.body,
        created_at: m.timestamp
      });
    }
  }

  const rawMessages = Array.from(msgMap.values());
  rawMessages.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

  if (rawMessages.length === 0) {
    return res.status(200).json({
      id: contactUid,
      chatId: contactUid,
      chatName: 'Unknown Client',
      summary: 'No message history available to summarize.',
      priority: 'low',
      category: 'General',
      sentiment: 'neutral',
      requiresFounder: false,
      createdAt: new Date().toISOString()
    });
  }

  // 3. Map messages into AI input format
  const messagesInput = rawMessages.map((m: any) => ({
    sender: m.direction === 'inbound' ? contactName : 'You',
    body: m.message_body || m.body || '',
    timestamp: m.created_at || m.timestamp || new Date().toISOString()
  }));

  // 4. Trigger LLM to generate digest summary
  const summaryResult = await AIService.summarizeConversation(contactName, messagesInput);

  // 5. Upsert digest in DB
  const digest = await prisma.digest.upsert({
    where: { id: contactUid },
    update: {
      chatId: contactUid,
      chatName: contactName,
      summary: summaryResult.summary,
      priority: (summaryResult.priority || 'medium') as any,
      category: summaryResult.category || 'General',
      sentiment: summaryResult.sentiment || 'neutral',
      requiresFounder: !!summaryResult.requires_founder,
      suggestedReply: summaryResult.suggested_reply || null,
      createdAt: new Date()
    },
    create: {
      id: contactUid,
      chatId: contactUid,
      chatName: contactName,
      summary: summaryResult.summary,
      priority: (summaryResult.priority || 'medium') as any,
      category: summaryResult.category || 'General',
      sentiment: summaryResult.sentiment || 'neutral',
      requiresFounder: !!summaryResult.requires_founder,
      suggestedReply: summaryResult.suggested_reply || null,
      createdAt: new Date()
    }
  });

  return res.status(200).json(digest);
}));

// --- Server-Sent Events (SSE) for Real-Time UI updates ---
export let sseClients: any[] = [];

app.get('/api/whatsapp/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  sseClients.push(res);
  logger.info({ clientCount: sseClients.length }, 'New SSE client connected');

  req.on('close', () => {
    sseClients = sseClients.filter(client => client !== res);
    logger.info({ clientCount: sseClients.length }, 'SSE client disconnected');
  });
});

export function broadcastWhatsAppEvent(event: string, data: any) {
  const payload = `data: ${JSON.stringify({ event, data })}\n\n`;
  sseClients.forEach(client => {
    try {
      client.write(payload);
    } catch (e: any) {
      logger.error('Failed to write to SSE client connection');
    }
  });
}

// 404 handler - must be before error handler
app.use(notFoundHandler);

// Error handler - must be last
app.use(errorHandler);

// --- Boot Server & Start Cron Scheduler ---
async function startServer() {
  // Test connection to PostgreSQL at boot
  await checkDatabaseConnection();

  const port = config.PORT;
  app.listen(port, () => {
    logger.info(`🚀 Founder Assistant OS Server is running on http://localhost:${port} in ${config.NODE_ENV} mode`);

    // Start Background Scheduler
    SchedulerService.init();
  });
}

startServer().catch((err) => {
  logger.fatal({ error: err.message }, 'Failed to start Express server');
  process.exit(1);
});

export default app;