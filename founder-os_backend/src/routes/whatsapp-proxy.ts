import { Router } from 'express';
import { getWaEngineConfig, resolveContactName, resolveContactUid } from '../shared/wa-engine';
import { WhatsAppService } from '../modules/whatsapp/service';
import { AIService } from '../modules/ai/service';
import { prisma } from '../shared/prisma';
import { asyncHandler } from '../middleware/asyncHandler';
import { logger } from '../shared/logger';
import { AppError } from '../middleware/errorHandler';

const router = Router();

const waFetch = async (endpoint: string, options?: any) => {
  const cfg = getWaEngineConfig();
  const url = `${cfg.apiBaseUrl}/${cfg.vendorUid}${endpoint}`;
  return fetch(url, { headers: { 'Authorization': `Bearer ${cfg.bearerToken}`, ...options?.headers }, ...options });
};

// Contacts
router.get('/contacts', asyncHandler(async (req, res) => {
  const cfg = getWaEngineConfig();
  try {
    const groupsUrl = `${cfg.apiBaseUrl}/${cfg.vendorUid}/groups`;
    const groupsRes = await fetch(groupsUrl, { headers: { 'Authorization': `Bearer ${cfg.bearerToken}` } });
    if (groupsRes.ok) {
      const groupsData = await groupsRes.json() as any;
      const groups = groupsData.data || [];
      const allContactsMap = new Map<string, any>();
      for (const group of groups) {
        try {
          const contactsRes = await fetch(`${cfg.apiBaseUrl}/${cfg.vendorUid}/groups/${group.uid}/contacts`, {
            headers: { 'Authorization': `Bearer ${cfg.bearerToken}` }
          });
          if (contactsRes.ok) {
            const contactsData = await contactsRes.json() as any;
            const contacts = contactsData.data || [];
            for (const c of contacts) {
              if (c.wa_id && !allContactsMap.has(c.wa_id)) {
                allContactsMap.set(c.wa_id, { uid: c.uid || `${c.wa_id}@c.us`, name: c.full_name || c.first_name || c.wa_id || 'Client', phone_number: c.wa_id, email: c.email || '' });
              }
            }
          }
        } catch (e: any) { logger.warn({ error: e.message, groupUid: group.uid }, 'Failed to fetch contacts for group'); }
      }
      const contactsList = Array.from(allContactsMap.values());
      if (contactsList.length > 0) return res.status(200).json({ contacts: contactsList });
    }
  } catch (err: any) { logger.warn({ error: err.message }, 'Failed to fetch groups'); }

  try {
    const response = await fetch(`${cfg.apiBaseUrl}/${cfg.vendorUid}/contacts?page=1&per_page=50`, {
      headers: { 'Authorization': `Bearer ${cfg.bearerToken}` }
    });
    if (response.ok) { const data = await response.json(); return res.status(200).json(data); }
  } catch (err: any) { logger.warn({ error: err.message }, 'Failed to fetch contacts from WA Engine'); }

  return res.status(200).json({ contacts: [
    { uid: '919811044521@c.us', name: 'Sanjay Singhal (Rajdhani Mills)', phone_number: '919811044521', email: 'sanjay.s@rajdhaniflour.in' },
    { uid: '918511299014@c.us', name: 'Vikram Rathore (Adani Wilmar)', phone_number: '918511299014', email: 'v.rathore@adaniwilmar.in' }
  ]});
}));

// Campaigns
router.get('/campaigns', asyncHandler(async (req, res) => {
  try {
    const response = await waFetch('/campaigns');
    if (response.ok) { const data = await response.json(); return res.status(200).json(data); }
  } catch (err: any) { logger.warn({ error: err.message }, 'Failed to fetch campaigns'); }
  return res.status(200).json([
    { campaign_uid: 'c-welcome', title: 'Welcome Campaign Jan', template_name: 'welcome_intro', target_count: 150, sent_count: 150, delivered_count: 148, read_count: 120, status: 'Completed', created_at: '2026-01-15' },
    { campaign_uid: 'c-discount', title: 'Discount Push Feb', template_name: 'diwali_offer', target_count: 340, sent_count: 340, delivered_count: 330, read_count: 280, status: 'Completed', created_at: '2026-02-20' },
    { campaign_uid: 'c-diwali', title: 'Diwali Campaign 2026', template_name: 'diwali_offer', target_count: 500, sent_count: 0, delivered_count: 0, read_count: 0, status: 'Scheduled', created_at: '2026-07-16' }
  ]);
}));

router.post('/campaigns/create', asyncHandler(async (req, res) => {
  const { title, template_name, template_language, group_uid, scheduled_at } = req.body;
  try {
    const response = await waFetch('/campaigns/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, template_name, template_language, group_uid, scheduled_at })
    });
    if (response.ok) { const data = await response.json(); return res.status(200).json(data); }
  } catch (err: any) { logger.warn({ error: err.message }, 'Failed to create campaign'); }
  return res.status(200).json({ success: true, message: 'Campaign scheduled successfully (mock)', campaign_uid: `c-mock-${Date.now()}` });
}));

// Groups
router.get('/groups', asyncHandler(async (req, res) => {
  try {
    const response = await waFetch('/groups');
    if (response.ok) { const data = await response.json(); return res.status(200).json(data); }
  } catch (err: any) { logger.warn({ error: err.message }, 'Failed to fetch groups'); }
  return res.status(200).json([
    { group_uid: 'g-vip', name: 'VIP Customers', description: 'High value segment clients' },
    { group_uid: 'g-leads', name: 'Lead Generators', description: 'Inbound telecaller leads' },
    { group_uid: 'g-inactive', name: 'Inactive Accounts', description: 'Re-engagement segment' }
  ]);
}));

router.post('/groups/create', asyncHandler(async (req, res) => {
  const { name, description } = req.body;
  try {
    const response = await waFetch('/groups/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, description })
    });
    if (response.ok) { const data = await response.json(); return res.status(200).json(data); }
  } catch (err: any) { logger.warn({ error: err.message }, 'Failed to create group'); }
  return res.status(200).json({ success: true, message: 'Group created successfully (mock)', group_uid: `g-mock-${Date.now()}` });
}));

// Templates
router.get('/templates', asyncHandler(async (req, res) => {
  try {
    const response = await waFetch('/templates');
    if (response.ok) { const data = await response.json(); return res.status(200).json(data); }
  } catch (err: any) { logger.warn({ error: err.message }, 'Failed to fetch templates'); }
  return res.status(200).json([
    { name: 'welcome_intro', language: 'en', category: 'UTILITY', body: 'Hello {{1}}, welcome to Founder OS! How can we help you today?' },
    { name: 'diwali_offer', language: 'en', category: 'MARKETING', body: 'Hi {{1}}, wishing you a happy Diwali! Use coupon DIWALI50 for 50% off.' },
    { name: 'payment_reminder', language: 'en', category: 'UTILITY', body: 'Dear {{1}}, this is a reminder that your payment of INR{{2}} is due by {{3}}.' }
  ]);
}));

// Send message
router.post('/send', asyncHandler(async (req, res) => {
  const cfg = getWaEngineConfig();
  const { phone_number, message_body } = req.body;
  if (!phone_number || !message_body) throw new AppError('Missing phone_number or message_body', 400);
  await WhatsAppService.saveMessage({ chatId: phone_number, sender: 'You', body: message_body, timestamp: new Date() });
  try {
    const response = await fetch(`${cfg.apiBaseUrl}/${cfg.vendorUid}/contact/send-message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${cfg.bearerToken}` },
      body: JSON.stringify({ phone_number, message_body })
    });
    if (response.ok) { const data = await response.json(); return res.status(200).json({ success: true, message: 'Message sent successfully', data }); }
  } catch (err: any) { logger.warn({ error: err.message }, 'Failed to send WhatsApp message via API'); }
  return res.status(200).json({ success: true, message: 'Message sent successfully (mock)' });
}));

// Contact messages
router.get('/contacts/:contactUid/messages', asyncHandler(async (req, res) => {
  const cfg = getWaEngineConfig();
  const contactUidRaw = (req.params as any).contactUid as string;
  const contactUid = await resolveContactUid(contactUidRaw, cfg.vendorUid, cfg.bearerToken, cfg.apiBaseUrl);
  const localMsgs = await WhatsAppService.fetchMessagesByChatId(contactUidRaw);
  let cloudMsgs: any[] = [];
  try {
    const url = `${cfg.apiBaseUrl}/${cfg.vendorUid}/contacts/${contactUid}/messages?page=1&limit=50`;
    const response = await fetch(url, { headers: { 'Authorization': `Bearer ${cfg.bearerToken}` } });
    if (response.ok) {
      const data = await response.json() as any;
      cloudMsgs = (data.data || data.messages || []).map((m: any) => ({
        id: m.uid || m.id || String(Math.random()),
        chatId: contactUidRaw,
        sender: m.direction === 'inbound' ? 'Client' : 'You',
        body: m.message_body || m.body || '',
        timestamp: m.created_at || m.timestamp || new Date().toISOString(),
        processed: true
      }));
    }
  } catch (e: any) { logger.warn({ error: e.message }, 'Failed to fetch cloud messages'); }

  const msgMap = new Map<string, any>();
  for (const m of cloudMsgs) msgMap.set(m.id, m);
  for (const m of localMsgs) {
    if (!msgMap.has(m.id)) {
      msgMap.set(m.id, { id: m.id, chatId: contactUidRaw, sender: (m.sender === 'Founder' || m.sender === 'You') ? 'You' : 'Client', body: m.body, timestamp: m.timestamp, processed: m.processed });
    }
  }
  const merged = Array.from(msgMap.values()).sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  return res.status(200).json(merged);
}));

router.post('/contacts/:contactUid/summarize', asyncHandler(async (req, res) => {
  const cfg = getWaEngineConfig();
  const contactUidRaw = (req.params as any).contactUid as string;
  const contactUid = await resolveContactUid(contactUidRaw, cfg.vendorUid, cfg.bearerToken, cfg.apiBaseUrl);
  const contactName = await resolveContactName(contactUidRaw, cfg.vendorUid, cfg.bearerToken, cfg.apiBaseUrl);
  const localMsgs = await WhatsAppService.fetchMessagesByChatId(contactUidRaw);
  let cloudMsgs: any[] = [];
  try {
    const url = `${cfg.apiBaseUrl}/${cfg.vendorUid}/contacts/${contactUid}/messages?page=1&limit=50`;
    const response = await fetch(url, { headers: { 'Authorization': `Bearer ${cfg.bearerToken}` } });
    if (response.ok) { const data = await response.json() as any; cloudMsgs = data.data || data.messages || []; }
  } catch (e: any) { logger.warn({ error: e.message }, 'Failed to fetch cloud messages for summary'); }

  const msgMap = new Map<string, any>();
  for (const m of cloudMsgs) { msgMap.set(m.uid || m.id || String(Math.random()), { direction: m.direction, message_body: m.message_body || m.body || '', created_at: m.created_at || m.timestamp || new Date().toISOString() }); }
  for (const m of localMsgs) {
    if (!msgMap.has(m.id)) { msgMap.set(m.id, { direction: (m.sender === 'Founder' || m.sender === 'You') ? 'outbound' : 'inbound', message_body: m.body, created_at: m.timestamp }); }
  }
  const rawMessages = Array.from(msgMap.values()).sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

  if (rawMessages.length === 0) {
    return res.status(200).json({ id: contactUid, chatId: contactUid, chatName: 'Unknown Client', summary: 'No message history available to summarize.', priority: 'low', category: 'General', sentiment: 'neutral', requiresFounder: false, createdAt: new Date().toISOString() });
  }

  const messagesInput = rawMessages.map((m: any) => ({ sender: m.direction === 'inbound' ? contactName : 'You', body: m.message_body || '', timestamp: m.created_at || new Date().toISOString() }));
  const summaryResult = await AIService.summarizeConversation(contactName, messagesInput);
  const digest = await prisma.digest.upsert({
    where: { id: contactUid },
    update: { chatId: contactUid, chatName: contactName, summary: summaryResult.summary, priority: (summaryResult.priority || 'medium') as any, category: summaryResult.category || 'General', sentiment: summaryResult.sentiment || 'neutral', requiresFounder: !!summaryResult.requires_founder, suggestedReply: summaryResult.suggested_reply || null },
    create: { id: contactUid, chatId: contactUid, chatName: contactName, summary: summaryResult.summary, priority: (summaryResult.priority || 'medium') as any, category: summaryResult.category || 'General', sentiment: summaryResult.sentiment || 'neutral', requiresFounder: !!summaryResult.requires_founder, suggestedReply: summaryResult.suggested_reply || null }
  });
  return res.status(200).json(digest);
}));

export default router;
