"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StorageRepository = void 0;
const prisma_1 = require("../../shared/prisma");
const logger_1 = require("../../shared/logger");
// --- In-Memory Database Arrays ---
let inMemoryMessages = [];
let inMemoryEmails = [];
let inMemoryDigests = [];
let inMemoryTasks = [];
let inMemoryFounderNotes = [];
// Helper function to seed in-memory arrays with realistic starter data
function seedInMemoryDb() {
    const now = new Date();
    // Seed raw WhatsApp messages
    const chatRahul = '918595563952@c.us';
    const chatOps = '120363023032@g.us';
    inMemoryMessages = [
        {
            id: 'msg-1',
            chatId: chatRahul,
            sender: 'Rahul (Investor)',
            body: 'Hey Sahil, hope you are doing well.',
            timestamp: new Date(now.getTime() - 20 * 60 * 1000),
            processed: true,
            createdAt: now,
        },
        {
            id: 'msg-2',
            chatId: chatRahul,
            sender: 'Rahul (Investor)',
            body: 'Wanted to follow up on the Q3 growth figures. Can we jump on a call tomorrow at 10 AM to discuss?',
            timestamp: new Date(now.getTime() - 19 * 60 * 1000),
            processed: true,
            createdAt: now,
        },
        {
            id: 'msg-3',
            chatId: chatRahul,
            sender: 'Rahul (Investor)',
            body: 'Also need the pitch deck updated with the latest revenue run-rate.',
            timestamp: new Date(now.getTime() - 18 * 60 * 1000),
            processed: true,
            createdAt: now,
        },
        {
            id: 'msg-4',
            chatId: chatOps,
            sender: 'Amit (Ops Manager)',
            body: 'Hi guys, we are facing an issue with the staging server deployment.',
            timestamp: new Date(now.getTime() - 15 * 60 * 1000),
            processed: false,
            createdAt: now,
        },
        {
            id: 'msg-5',
            chatId: chatOps,
            sender: 'Neha (Tech Lead)',
            body: 'Yes, the database migrations are failing because of a locked connection. I need someone to check the database logs.',
            timestamp: new Date(now.getTime() - 14 * 60 * 1000),
            processed: false,
            createdAt: now,
        },
    ];
    // Seed raw Emails
    inMemoryEmails = [
        {
            id: 'email-1',
            subject: 'URGENT: Stripe Account Verification Action Needed',
            sender: 'support@stripe.com',
            body: 'Hello Sahil, your account requires additional identity verification. Please upload the requested documents within 48 hours to avoid payout disruptions.',
            processed: false,
            createdAt: now,
        },
        {
            id: 'email-2',
            subject: 'Partnership Proposal - TechCorp',
            sender: 'john.doe@techcorp.com',
            body: 'Hi Sahil, I am John from TechCorp. We love what you are building and would love to explore a distribution partnership. Are you free for an introductory call next Tuesday?',
            processed: false,
            createdAt: now,
        },
    ];
    // Seed Digests
    inMemoryDigests = [
        {
            id: 'digest-1',
            chatId: chatRahul,
            chatName: 'Rahul (Investor)',
            summary: 'Rahul followed up on the Q3 growth figures, requested a meeting at 10 AM tomorrow, and asked for an updated pitch deck with current run-rate revenue.',
            priority: 'high',
            category: 'Investor',
            sentiment: 'neutral',
            requiresFounder: true,
            suggestedReply: 'Thanks Rahul, I will make sure the revised valuations and pitch deck are in your inbox tonight. Let\'s sync tomorrow at 10 AM.',
            createdAt: new Date(now.getTime() - 15 * 60 * 1000),
        },
    ];
    // Seed Tasks
    inMemoryTasks = [
        {
            id: 'task-1',
            title: 'Update pitch deck with latest revenue run-rate',
            owner: 'Founder',
            status: 'PENDING',
            deadline: new Date(now.getTime() + 24 * 3600 * 1000),
            source: 'WHATSAPP',
            sourceId: 'digest-1',
            createdAt: now,
        },
        {
            id: 'task-2',
            title: 'Prepare Q3 valuations & growth slide deck figures',
            owner: 'Founder',
            status: 'PENDING',
            deadline: new Date(now.getTime() + 24 * 3600 * 1000),
            source: 'WHATSAPP',
            sourceId: 'digest-1',
            createdAt: now,
        },
    ];
    // Seed Founder Briefing
    inMemoryFounderNotes = [
        {
            id: 'brief-1',
            content: `# Morning Briefing - ${now.toLocaleDateString()}

## 📅 Today's Schedule & Meetings
- 10:00 AM: Review Call with Rahul (Investor) - Prep valuations deck.
- No other calendar syncs scheduled.

## 🚨 Urgent Matters (Requires Immediate Attention)
- **WhatsApp**: Rahul (Investor) requested Q3 growth figures and updated pitch deck revenue numbers.
- **Email**: Stripe Support requested verification documents within 48 hours to prevent account lockout.

## 💬 High-Priority Conversations
- **Rahul (Investor)**: Active discussions regarding Q3 slide deck valuations. Suggested reply prepared.

## 📋 Pending Action Items & Tasks
- [PENDING] Update pitch deck with latest revenue run-rate (Due: Tomorrow, Source: WhatsApp)
- [PENDING] Prepare Q3 valuations & growth slide deck figures (Due: Tomorrow, Source: WhatsApp)

## 🎯 Suggested Focus Areas for Today
1. Update pitch deck revenue run-rates before the 10:00 AM call.
2. Complete Stripe document uploads to avoid payout disruption.
3. Review staging server deployment issues with Amit.
`,
            createdAt: now,
        },
    ];
}
// Perform initial seed of in-memory data
seedInMemoryDb();
class StorageRepository {
    // --- Message Repository Operations ---
    static async saveMessage(data) {
        if (prisma_1.useInMemoryDb) {
            logger_1.logger.info(data, 'InMemory: Saving message');
            const newMsg = {
                id: `msg-${Math.random().toString(36).substr(2, 9)}`,
                chatId: data.chatId,
                sender: data.sender,
                body: data.body,
                timestamp: data.timestamp,
                processed: false,
                createdAt: new Date(),
            };
            inMemoryMessages.push(newMsg);
            return newMsg;
        }
        logger_1.logger.info({ chatId: data.chatId, sender: data.sender }, 'Saving raw message to storage');
        return prisma_1.prisma.message.create({
            data: {
                chatId: data.chatId,
                sender: data.sender,
                body: data.body,
                timestamp: data.timestamp,
                processed: false,
            },
        });
    }
    static async fetchUnprocessedMessages() {
        if (prisma_1.useInMemoryDb) {
            logger_1.logger.info('InMemory: Fetching unprocessed messages');
            return inMemoryMessages.filter((m) => !m.processed);
        }
        logger_1.logger.debug('Fetching unprocessed messages from storage');
        return prisma_1.prisma.message.findMany({
            where: { processed: false },
            orderBy: { timestamp: 'asc' },
        });
    }
    static async markMessagesProcessed(messageIds) {
        if (prisma_1.useInMemoryDb) {
            logger_1.logger.info({ count: messageIds.length }, 'InMemory: Marking messages processed');
            inMemoryMessages = inMemoryMessages.map((m) => messageIds.includes(m.id) ? { ...m, processed: true } : m);
            return;
        }
        logger_1.logger.info({ count: messageIds.length }, 'Marking messages as processed');
        if (messageIds.length === 0)
            return;
        return prisma_1.prisma.message.updateMany({
            where: { id: { in: messageIds } },
            data: { processed: true },
        });
    }
    static async fetchMessagesByChatId(chatId, limit = 50) {
        if (prisma_1.useInMemoryDb) {
            logger_1.logger.info({ chatId }, 'InMemory: Fetching chat messages');
            return inMemoryMessages
                .filter((m) => m.chatId === chatId)
                .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
                .slice(0, limit);
        }
        logger_1.logger.debug({ chatId, limit }, 'Fetching messages for chat');
        return prisma_1.prisma.message.findMany({
            where: { chatId },
            orderBy: { timestamp: 'desc' },
            take: limit,
        });
    }
    // --- Email Repository Operations ---
    static async storeEmail(data) {
        if (prisma_1.useInMemoryDb) {
            logger_1.logger.info(data, 'InMemory: Saving email');
            const newEmail = {
                id: `email-${Math.random().toString(36).substr(2, 9)}`,
                subject: data.subject,
                sender: data.sender,
                body: data.body,
                processed: false,
                createdAt: new Date(),
            };
            inMemoryEmails.push(newEmail);
            return newEmail;
        }
        logger_1.logger.info({ sender: data.sender, subject: data.subject }, 'Saving email to storage');
        return prisma_1.prisma.email.create({
            data: {
                subject: data.subject,
                sender: data.sender,
                body: data.body,
                processed: false,
            },
        });
    }
    static async fetchUnprocessedEmails() {
        if (prisma_1.useInMemoryDb) {
            logger_1.logger.info('InMemory: Fetching unprocessed emails');
            return inMemoryEmails.filter((e) => !e.processed);
        }
        logger_1.logger.debug('Fetching unprocessed emails from storage');
        return prisma_1.prisma.email.findMany({
            where: { processed: false },
            orderBy: { createdAt: 'asc' },
        });
    }
    static async markEmailsProcessed(emailIds) {
        if (prisma_1.useInMemoryDb) {
            logger_1.logger.info({ count: emailIds.length }, 'InMemory: Marking emails processed');
            inMemoryEmails = inMemoryEmails.map((e) => emailIds.includes(e.id) ? { ...e, processed: true } : e);
            return;
        }
        logger_1.logger.info({ count: emailIds.length }, 'Marking emails as processed');
        if (emailIds.length === 0)
            return;
        return prisma_1.prisma.email.updateMany({
            where: { id: { in: emailIds } },
            data: { processed: true },
        });
    }
    // --- Digest Repository Operations ---
    static async saveDigest(data) {
        if (prisma_1.useInMemoryDb) {
            logger_1.logger.info(data, 'InMemory: Saving digest');
            const newDigest = {
                id: `digest-${Math.random().toString(36).substr(2, 9)}`,
                chatId: data.chatId,
                chatName: data.chatName,
                summary: data.summary,
                priority: data.priority,
                category: data.category,
                sentiment: data.sentiment,
                requiresFounder: data.requiresFounder,
                suggestedReply: data.suggestedReply || null,
                createdAt: new Date(),
            };
            inMemoryDigests.push(newDigest);
            return newDigest;
        }
        logger_1.logger.info({ chatId: data.chatId, priority: data.priority }, 'Saving digest to storage');
        return prisma_1.prisma.digest.create({
            data: {
                chatId: data.chatId,
                chatName: data.chatName,
                summary: data.summary,
                priority: data.priority,
                category: data.category,
                sentiment: data.sentiment,
                requiresFounder: data.requiresFounder,
                suggestedReply: data.suggestedReply || null,
            },
        });
    }
    static async fetchDigests(limit = 100) {
        if (prisma_1.useInMemoryDb) {
            logger_1.logger.info('InMemory: Fetching digests');
            return [...inMemoryDigests].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, limit);
        }
        logger_1.logger.debug({ limit }, 'Fetching digests from storage');
        return prisma_1.prisma.digest.findMany({
            orderBy: { createdAt: 'desc' },
            take: limit,
        });
    }
    // --- Task Repository Operations ---
    static async createTask(data) {
        if (prisma_1.useInMemoryDb) {
            logger_1.logger.info(data, 'InMemory: Creating task');
            const newTask = {
                id: `task-${Math.random().toString(36).substr(2, 9)}`,
                title: data.title,
                owner: data.owner,
                status: data.status || 'PENDING',
                deadline: data.deadline || null,
                source: data.source,
                sourceId: data.sourceId || null,
                createdAt: new Date(),
            };
            inMemoryTasks.push(newTask);
            return newTask;
        }
        logger_1.logger.info({ title: data.title, owner: data.owner }, 'Creating task in storage');
        return prisma_1.prisma.task.create({
            data: {
                title: data.title,
                owner: data.owner,
                status: data.status || 'PENDING',
                deadline: data.deadline || null,
                source: data.source,
                sourceId: data.sourceId || null,
            },
        });
    }
    static async fetchTasks() {
        if (prisma_1.useInMemoryDb) {
            logger_1.logger.info('InMemory: Fetching tasks');
            return [...inMemoryTasks].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        }
        logger_1.logger.debug('Fetching tasks from storage');
        return prisma_1.prisma.task.findMany({
            orderBy: { createdAt: 'desc' },
        });
    }
    // --- Founder Briefings / Notes Operations ---
    static async saveFounderNote(content) {
        if (prisma_1.useInMemoryDb) {
            logger_1.logger.info('InMemory: Saving founder briefing/note');
            const newNote = {
                id: `brief-${Math.random().toString(36).substr(2, 9)}`,
                content,
                createdAt: new Date(),
            };
            inMemoryFounderNotes.push(newNote);
            return newNote;
        }
        logger_1.logger.info('Saving founder briefing/note to storage');
        return prisma_1.prisma.founderNote.create({
            data: {
                content,
            },
        });
    }
    static async fetchLatestFounderNote() {
        if (prisma_1.useInMemoryDb) {
            logger_1.logger.info('InMemory: Fetching latest founder note');
            if (inMemoryFounderNotes.length === 0)
                return null;
            return [...inMemoryFounderNotes].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
        }
        logger_1.logger.debug('Fetching latest founder note/briefing');
        return prisma_1.prisma.founderNote.findFirst({
            orderBy: { createdAt: 'desc' },
        });
    }
}
exports.StorageRepository = StorageRepository;
exports.default = StorageRepository;
