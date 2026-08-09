import { Router } from 'express';
import { StorageRepository } from '../modules/storage/repository';
import { asyncHandler } from '../middleware/asyncHandler';

const router = Router();

/**
 * GET /api/pending-items
 * Returns all open "Pending From Me" items across all chats, grouped by chat.
 * This is the founder's "What I Owe" view — every chat with open items, and
 * within each chat, the list of things pending from the founder's side.
 */
router.get('/', asyncHandler(async (req, res) => {
    const openItems = await StorageRepository.fetchOpenChatPendingItems();

    // Group by chatId so the founder sees per-chat pending items.
    const grouped = new Map<string, any[]>();
    for (const item of openItems) {
        const list = grouped.get(item.chatId) || [];
        list.push(item);
        grouped.set(item.chatId, list);
    }

    const chats = Array.from(grouped.entries()).map(([chatId, items]) => ({
        chatId,
        chatName: items[0]?.chatName || chatId,
        openCount: items.length,
        items,
    }));

    // Sort chats by most overdue first (earliest due date).
    chats.sort((a, b) => {
        const aDue = a.items.find((i: any) => i.dueDate)?.dueDate;
        const bDue = b.items.find((i: any) => i.dueDate)?.dueDate;
        if (aDue && bDue) return new Date(aDue).getTime() - new Date(bDue).getTime();
        if (aDue) return -1;
        if (bDue) return 1;
        return 0;
    });

    res.status(200).json({ totalOpen: openItems.length, chats });
}));

/**
 * GET /api/pending-items/chat/:chatId
 * Returns open pending items for a specific chat.
 */
router.get('/chat/:chatId', asyncHandler(async (req, res) => {
    const chatId = String(req.params.chatId);
    const items = await StorageRepository.fetchOpenChatPendingItems(chatId);
    res.status(200).json({ chatId, items });
}));

/**
 * POST /api/pending-items/:id/resolve
 * Manually mark a pending item as done.
 */
router.post('/:id/resolve', asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const item = await StorageRepository.resolveChatPendingItem(id, 'MANUAL');
    if (!item) {
        res.status(404).json({ error: 'Pending item not found or already resolved' });
        return;
    }
    res.status(200).json(item);
}));

/**
 * POST /api/pending-items/:id/cancel
 * Manually cancel a pending item (no longer relevant).
 */
router.post('/:id/cancel', asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const item = await StorageRepository.cancelChatPendingItem(id);
    if (!item) {
        res.status(404).json({ error: 'Pending item not found or already resolved' });
        return;
    }
    res.status(200).json(item);
}));

export default router;