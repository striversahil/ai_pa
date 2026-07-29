export interface ClassificationResult {
  isPending: boolean;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
  suggestedAction: string | null;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  category: string;
}

export function heuristicClassify(body: string): ClassificationResult {
  const lower = body.toLowerCase();

  const mediaPrefixes = ['[image]', '[video]', '[audio]', '[document', '[location]', '[poll]', '[sticker]', '[contact'];
  const hasMediaPrefix = mediaPrefixes.some(p => lower.startsWith(p));

  if (hasMediaPrefix) {
    return {
      isPending: true,
      confidence: 'low',
      reason: 'Message contains media that may require review or response.',
      suggestedAction: 'Review the media and respond if needed.',
      priority: 'medium',
      category: 'Customer',
    };
  }

  if (body.trim()) {
    const pendingKeywords = [
      'urgent', 'asap', 'please', 'need', 'required', 'help', 'issue',
      'problem', 'broken', 'not working', 'when', 'how much', 'quote',
      'price', 'order', 'delivery', 'complaint', 'follow up', 'request',
      'can you', 'could you', 'would you', 'send me', 'call me',
    ];

    const hasPendingKeyword = pendingKeywords.some(k => lower.includes(k));
    const isQuestion = body.includes('?');

    if (hasPendingKeyword || isQuestion) {
      return {
        isPending: true,
        confidence: 'medium',
        reason: hasPendingKeyword
          ? 'Message contains keywords indicating a request or action item.'
          : 'Message is a question requiring a response.',
        suggestedAction: 'Review and respond to the sender.',
        priority: hasPendingKeyword && lower.includes('urgent') ? 'urgent' : 'medium',
        category: 'Customer',
      };
    }
  }

  return {
    isPending: false,
    confidence: 'medium',
    reason: 'Message appears informational with no action required.',
    suggestedAction: null,
    priority: 'low',
    category: 'Informational',
  };
}