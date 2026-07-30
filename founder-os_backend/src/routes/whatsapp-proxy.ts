import { Router } from 'express';
import { WhatsAppService } from '../modules/whatsapp/service';
import { OutboundService } from '../modules/whatsapp/outbound';
import { AIService } from '../modules/ai/service';
import { prisma } from '../shared/prisma';
import { asyncHandler } from '../middleware/asyncHandler';
import { logger } from '../shared/logger';
import { AppError } from '../middleware/errorHandler';

const router = Router();

router.get('/contacts', asyncHandler(async (req, res) => {
  try {
    const chats = await WhatsAppService.fetchWahaChats();
    if (chats.length > 0) {
      const contacts = chats.map(c => ({
        uid: c.id,
        name: c.name || c.id.split('@')[0] || 'Unknown',
        phone_number: c.id.split('@')[0] || c.id,
        email: '',
      }));
      return res.status(200).json({ contacts });
    }
  } catch (e: any) {
    logger.warn({ error: e.message }, 'Failed to fetch chats from WAHA');
  }
  return res.status(200).json({ contacts: [
    { uid: '919811044521@c.us', name: 'Sanjay Singhal (Rajdhani Mills)', phone_number: '919811044521', email: '' },
    { uid: '918511299014@c.us', name: 'Vikram Rathore (Adani Wilmar)', phone_number: '918511299014', email: '' },
  ]});
}));

router.post('/send', asyncHandler(async (req, res) => {
  const { chatId, message_body } = req.body;
  if (!chatId || !message_body) throw new AppError('Missing chatId or message_body', 400);
  await WhatsAppService.saveMessage({ chatId, sender: 'You', body: message_body, timestamp: new Date() });
  const result = await OutboundService.sendWithJitter(chatId, message_body);
  res.status(200).json({ success: true, result });
}));

router.get('/contacts/:contactUid/messages', asyncHandler(async (req, res) => {
  const contactUidRaw = (req.params as any).contactUid as string;
  const [localMsgs, wahaMsgs] = await Promise.all([
    WhatsAppService.fetchMessagesByChatId(contactUidRaw),
    WhatsAppService.fetchWahaMessages(contactUidRaw, 50),
  ]);
  const msgMap = new Map<string, any>();
  for (const m of wahaMsgs) {
    msgMap.set(m.id, {
      id: m.id,
      chatId: contactUidRaw,
      sender: m.fromMe ? 'You' : 'Client',
      body: m.body,
      timestamp: m.timestamp,
      processed: true,
    });
  }
  for (const m of localMsgs) {
    const key = m.wahaMessageId || m.id;
    if (!msgMap.has(key)) {
      msgMap.set(key, {
        id: m.id,
        chatId: contactUidRaw,
        sender: (m.sender === 'Founder' || m.sender === 'You') ? 'You' : 'Client',
        body: m.body,
        timestamp: m.timestamp,
        processed: m.processed,
      });
    }
  }
  const merged = Array.from(msgMap.values())
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  return res.status(200).json(merged);
}));

router.post('/contacts/:contactUid/summarize', asyncHandler(async (req, res) => {
  const contactUidRaw = (req.params as any).contactUid as string;
  const contactName = contactUidRaw.split('@')[0] || 'Client';
  const [localMsgs, wahaMsgs] = await Promise.all([
    WhatsAppService.fetchMessagesByChatId(contactUidRaw),
    WhatsAppService.fetchWahaMessages(contactUidRaw, 50),
  ]);
  const msgMap = new Map<string, any>();
  for (const m of wahaMsgs) {
    msgMap.set(m.id, { direction: m.fromMe ? 'outbound' : 'inbound', message_body: m.body, created_at: m.timestamp });
  }
  for (const m of localMsgs) {
    const key = m.wahaMessageId || m.id;
    if (!msgMap.has(key)) {
      msgMap.set(key, { direction: (m.sender === 'Founder' || m.sender === 'You') ? 'outbound' : 'inbound', message_body: m.body, created_at: m.timestamp });
    }
  }
  const rawMessages = Array.from(msgMap.values())
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  if (rawMessages.length === 0) {
    return res.status(200).json({
      id: contactUidRaw, chatId: contactUidRaw, chatName: contactName,
      summary: 'No message history available to summarize.',
      priority: 'low', category: 'General', sentiment: 'neutral',
      requiresFounder: false, createdAt: new Date().toISOString(),
    });
  }
  const messagesInput = rawMessages.map((m: any) => ({
    sender: m.direction === 'inbound' ? contactName : 'You',
    body: m.message_body || '',
    timestamp: m.created_at || new Date().toISOString(),
  }));
  const summaryResult = await AIService.summarizeConversation(contactName, messagesInput);
  const digest = await prisma.digest.upsert({
    where: { id: contactUidRaw },
    update: {
      chatId: contactUidRaw, chatName: contactName,
      summary: summaryResult.summary,
      priority: (summaryResult.priority || 'medium') as any,
      category: summaryResult.category || 'General',
      sentiment: summaryResult.sentiment || 'neutral',
      requiresFounder: !!summaryResult.requires_founder,
      suggestedReply: summaryResult.suggested_reply || null,
    },
    create: {
      id: contactUidRaw, chatId: contactUidRaw, chatName: contactName,
      summary: summaryResult.summary,
      priority: (summaryResult.priority || 'medium') as any,
      category: summaryResult.category || 'General',
      sentiment: summaryResult.sentiment || 'neutral',
      requiresFounder: !!summaryResult.requires_founder,
      suggestedReply: summaryResult.suggested_reply || null,
    },
  });
  return res.status(200).json(digest);
}));

export default router;