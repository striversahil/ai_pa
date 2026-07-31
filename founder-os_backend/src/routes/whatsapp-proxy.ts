import { Router } from 'express';
import { WhatsAppService } from '../modules/whatsapp/service';
import { StorageRepository } from '../modules/storage/repository';
import { OutboundService } from '../modules/whatsapp/outbound';
import { MessageQueueService } from '../modules/queue/service';
import { AIService } from '../modules/ai/service';
import { prisma } from '../shared/prisma';
import { logger } from '../shared/logger';
import { asyncHandler } from '../middleware/asyncHandler';
import { AppError } from '../middleware/errorHandler';

const router = Router();

router.get('/contacts', asyncHandler(async (req, res) => {
  const dbContacts = await StorageRepository.fetchContacts();
  const contacts = dbContacts.map(c => ({
    uid: c.chatId,
    name: c.name,
    phone_number: c.phoneNumber,
    pushName: c.pushName,
    isGroup: c.isGroup,
    lastMessageAt: c.lastMessageAt,
    lastMessageBody: c.lastMessageBody,
    unreadCount: c.unreadCount,
  }));
  return res.status(200).json({ contacts });
}));

function validateChatId(chatId: string): string | null {
  const trimmed = chatId.trim();
  if (trimmed.endsWith('@g.us')) return null;
  if (!trimmed.endsWith('@c.us')) return 'chatId must end with @c.us for individual chats';
  if (/\+/.test(trimmed)) return 'chatId must not contain + sign (use e.g. 919876543210@c.us)';
  const match = trimmed.match(/^(\d+)@c\.us$/);
  if (!match) return 'chatId must be digits followed by @c.us (e.g. 919876543210@c.us)';
  const digits = match[1];
  const localNumber = digits.slice(-10);
  const countryCode = digits.slice(0, -10);
  if (!countryCode || !/^\d+$/.test(countryCode)) return 'chatId must include a numeric country code (e.g. 919876543210@c.us)';
  if (!/^\d{10}$/.test(localNumber)) return 'chatId must contain exactly 10 digits after the country code (e.g. 919876543210@c.us)';
  return null;
}

router.post('/send', asyncHandler(async (req, res) => {
  const { chatId, message_body } = req.body;
  if (!chatId || !message_body) throw new AppError('Missing chatId or message_body', 400);
  const validationError = validateChatId(chatId);
  if (validationError) throw new AppError(validationError, 400);
  await WhatsAppService.saveMessage({ chatId, sender: 'You', body: message_body, timestamp: new Date() });
  const result = await OutboundService.sendWithJitter(chatId, message_body);
  if (result === 'rate_limited' || result === 'failed') {
    // Account/burst cap reached or WAHA rejected the send: defer instead of
    // dropping, and never fire in bulk.
    await MessageQueueService.enqueueDelayedMorning(chatId, message_body, 30 * 60 * 1000 + Math.floor(Math.random() * 30 * 60 * 1000));
    logger.warn({ chatId, result }, 'Send not delivered now: deferred to retry queue');
  }
  res.status(200).json({ success: true, result });
}));

router.get('/contacts/:contactUid/messages', asyncHandler(async (req, res) => {
  const chatId = String(req.params.contactUid);
  const messages = await WhatsAppService.fetchMessagesByChatId(chatId);
  const sorted = messages.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  return res.status(200).json(sorted);
}));

router.post('/contacts/:contactUid/summarize', asyncHandler(async (req, res) => {
  const chatId = String(req.params.contactUid);
  const contact = await StorageRepository.fetchContactByChatId(chatId);
  const contactName = contact?.name || chatId.split('@')[0];

  const localMsgs = await WhatsAppService.fetchMessagesByChatId(chatId);
  if (localMsgs.length === 0) {
    return res.status(200).json({
      id: chatId, chatId, chatName: contactName,
      summary: 'No message history available to summarize.',
      priority: 'low', category: 'General', sentiment: 'neutral',
      requiresFounder: false, createdAt: new Date().toISOString()
    });
  }

  const messagesInput = localMsgs
    .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
    .map(m => ({ sender: m.sender === 'You' || m.sender === 'Founder' ? 'You' : m.sender, body: m.body, timestamp: m.timestamp }));

  const summaryResult = await AIService.summarizeConversation(contactName, messagesInput);

  const digest = await prisma.digest.upsert({
    where: { id: chatId },
    update: { chatId, chatName: contactName, summary: summaryResult.summary, priority: (summaryResult.priority || 'medium') as any, category: summaryResult.category || 'General', sentiment: summaryResult.sentiment || 'neutral', requiresFounder: !!summaryResult.requires_founder, suggestedReply: summaryResult.suggested_reply || null },
    create: { id: chatId, chatId, chatName: contactName, summary: summaryResult.summary, priority: (summaryResult.priority || 'medium') as any, category: summaryResult.category || 'General', sentiment: summaryResult.sentiment || 'neutral', requiresFounder: !!summaryResult.requires_founder, suggestedReply: summaryResult.suggested_reply || null }
  });
  return res.status(200).json(digest);
}));

export default router;
