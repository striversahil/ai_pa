import OpenAI from 'openai';
import { config } from '../../config';
import { logger } from '../../shared/logger';
import { summarizeConversationPrompt } from './prompts/summarizeConversation';
import { incrementalSummarizeConversationPrompt } from './prompts/incrementalSummarizeConversation';
import { generateBriefPrompt } from './prompts/generateBrief';
import { generateDailySummaryPrompt } from './prompts/generateDailySummary';
import { answerFounderQuestionPrompt } from './prompts/answerFounderQuestion';
import { classifyEstimatePrompt } from './prompts/classifyEstimate';
import { extractEnquiryPrompt } from './prompts/extractEnquiry';
import { matchBusinessPrompt } from './prompts/matchBusiness';
import { classifyMessagePrompt } from './prompts/classifyMessage';
import { brainQueryPrompt } from './prompts/brainQuery';


// Determine if we should mock LLM responses
const isMockLLM = !config.LLM_API_KEY || config.LLM_API_KEY === 'your_api_key_here';

// Extract API keys from a comma-separated list
const apiKeys = !isMockLLM
  ? config.LLM_API_KEY.split(',').map((k) => k.trim()).filter(Boolean)
  : [];

export interface SummaryOutput {
  chatName: string;
  summary: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  category: string;
  sentiment: string;
  action_items: Array<{
    task: string;
    owner: string;
    deadline: string | null;
  }>;
  requires_founder: boolean;
  suggested_reply: string | null;
  pending_from_founder?: Array<{
    description: string;
    due_date: string | null;
  }>;
}

export class AIService {
  static metrics = { totalCalls: 0, failedCalls: 0 };

  private static async callLLM<T>(apiCall: (openai: OpenAI, model: string) => Promise<T>): Promise<T> {
    if (isMockLLM || apiKeys.length === 0) {
      throw new Error('LLM is mocked or API key is missing');
    }

    const shuffledKeys = [...apiKeys].sort(() => Math.random() - 0.5);
    let lastError: any = null;

    // Fallback models to try on rate limits or model deprecations
    const groqModels = [
      'llama-3.3-70b-versatile',
      'llama-3.1-8b-instant',
      'gemma2-9b-it'
    ];
    const openaiModels = [
      'gpt-4o-mini',
      'gpt-4o'
    ];

    for (let i = 0; i < shuffledKeys.length; i++) {
      const key = shuffledKeys[i];
      const maskedKey = key.length > 12
        ? `${key.substring(0, 8)}...${key.substring(key.length - 4)}`
        : '***';

      const isGroq = key.startsWith('gsk_');
      const modelsToTry = isGroq ? groqModels : openaiModels;

      const configModel = config.LLM_MODEL;
      const finalModels = [...modelsToTry];
      if (configModel) {
        const idx = finalModels.indexOf(configModel);
        if (idx > -1) {
          finalModels.splice(idx, 1);
        }
        finalModels.unshift(configModel);
      }

      for (const model of finalModels) {
        try {
          this.metrics.totalCalls++;
          const client = new OpenAI({
            apiKey: key,
            baseURL: isGroq ? 'https://api.groq.com/openai/v1' : (config.LLM_BASE_URL || 'https://api.openai.com/v1'),
          });
          const result = await apiCall(client, model);
          if (model !== finalModels[0]) {
            logger.info(`AIService: Succeeded with fallback model ${model} (Key: ${maskedKey})`);
          }
          return result;
        } catch (err: any) {
          lastError = err;
          const status = err.status || err.statusCode;
          const msg = (err.message || '').toLowerCase();

          const isRateLimit = status === 429 || msg.includes('429') || msg.includes('rate limit');
          const isModelError = status === 400 || status === 404 || msg.includes('decommissioned') || msg.includes('not support') || msg.includes('not found');

          if (isRateLimit || isModelError) {
            logger.warn(
              `AIService: API Key ${maskedKey} with model ${model} failed (${status || err.message}). Attempting fallback model/key...`
            );
            continue;
          }
          this.metrics.failedCalls++;
          throw err;
        }
      }
    }

    this.metrics.failedCalls++;
    logger.error('AIService: All configured LLM API keys and fallback models returned rate limit errors.');
    throw lastError || new Error('All LLM keys and models exhausted.');
  }

  private static cleanJsonString(raw: string): string {
    let clean = raw.trim();
    if (clean.startsWith('```')) {
      clean = clean.replace(/^```(json)?/i, '');
      clean = clean.replace(/```$/, '');
    }
    return clean.trim();
  }

  /**
   * Summarizes WhatsApp chats. Uses mock logic if key is unconfigured.
   */
  static async summarizeConversation(
    chatName: string,
    messages: Array<{ sender: string; body: string; timestamp: Date; replyTo?: string | null }>,
    founderContext = ''
  ): Promise<SummaryOutput> {
    const startTime = Date.now();
    logger.info({ chatName, isMocked: isMockLLM }, 'AIService: digesting conversation');

    if (isMockLLM) {
      // Simulate LLM delay
      await new Promise((r) => setTimeout(r, 600));

      const chatLower = chatName.toLowerCase();
      const bodiesCombined = messages.map((m) => m.body).join(' ').toLowerCase();

      // Case 1: Rahul (Investor)
      if (chatLower.includes('rahul') || chatLower.includes('investor')) {
        return {
          chatName: 'Rahul (Investor)',
          summary: 'Rahul followed up on the Q3 growth figures, requested a meeting at 10 AM tomorrow, and asked for an updated pitch deck with current run-rate revenue.',
          priority: 'high',
          category: 'Investor',
          sentiment: 'neutral',
          action_items: [
            {
              task: 'Update pitch deck with latest revenue run-rate',
              owner: 'Founder',
              deadline: new Date(Date.now() + 24 * 3600 * 1000).toISOString().split('T')[0],
            },
            {
              task: 'Prepare Q3 valuations & growth slide deck figures',
              owner: 'Founder',
              deadline: new Date(Date.now() + 24 * 3600 * 1000).toISOString().split('T')[0],
            },
          ],
          requires_founder: true,
          suggested_reply: 'Thanks Rahul, I will make sure the revised valuations and pitch deck are in your inbox tonight. Let\'s sync tomorrow at 10 AM.',
          pending_from_founder: [
            { description: 'Update pitch deck with latest revenue run-rate', due_date: new Date(Date.now() + 24 * 3600 * 1000).toISOString().split('T')[0] },
            { description: 'Prepare Q3 valuations & growth slide deck figures', due_date: new Date(Date.now() + 24 * 3600 * 1000).toISOString().split('T')[0] },
            { description: 'Confirm the 10 AM meeting with Rahul tomorrow', due_date: new Date(Date.now() + 24 * 3600 * 1000).toISOString().split('T')[0] },
          ],
        };
      }

      // Case 2: Operations Group / Staging
      if (bodiesCombined.includes('staging') || bodiesCombined.includes('migration') || bodiesCombined.includes('locked')) {
        return {
          chatName: 'Operations Team Sync',
          summary: 'The operations team is facing issues with locked connections during database migrations on the staging server. Neha needs logs reviewed.',
          priority: 'medium',
          category: 'Operations',
          sentiment: 'negative',
          action_items: [
            {
              task: 'Review locked database connection logs on staging server',
              owner: 'Founder',
              deadline: null,
            },
          ],
          requires_founder: true,
          suggested_reply: 'Amit, I am on it. Checking the database pool locks now to release the migration session.',
          pending_from_founder: [
            { description: 'Review locked database connection logs on staging server', due_date: null },
          ],
        };
      }

      // Case 3: Default generic digestion
      return {
        chatName,
        summary: `Discussion regarding general operational updates. Sender: ${chatName}.`,
        priority: 'low',
        category: 'Operations',
        sentiment: 'neutral',
        action_items: [],
        requires_founder: false,
        suggested_reply: null,
        pending_from_founder: [],
      };
    }

    // Call Real LLM
    try {
      const response = await this.callLLM(async (client, model) => {
        return client.chat.completions.create({
          model: model,
          messages: [
            { role: 'system', content: summarizeConversationPrompt },
            {
              role: 'user', content: `Chat Name: ${chatName}\n${founderContext.length > 0 ? `Founder's personal context for this chat (actively watch for these):\n${founderContext}\n` : ''}\nMessages:\n${messages.map((m) => {
                const ts = typeof m.timestamp === 'string' ? m.timestamp : (m.timestamp instanceof Date ? m.timestamp.toISOString() : new Date(m.timestamp).toISOString());
                const quoted = m.replyTo ? ` [replying to: "${m.replyTo}"]` : '';
                return `[${ts}] ${m.sender}: ${m.body}${quoted}`;
              }).join('\n')}`
            },
          ],
          temperature: 0.1,
        });
      });

      const latency = Date.now() - startTime;
      logger.info({ latency }, 'Real LLM summarization completed');

      const rawContent = response.choices[0]?.message?.content || '';
      const cleanJson = this.cleanJsonString(rawContent);
      return JSON.parse(cleanJson) as SummaryOutput;
    } catch (err: any) {
      logger.error({ error: err.message }, 'Real LLM summarization failed');
      throw err;
    }
  }

  /**
   * Incrementally summarizes WhatsApp chats given a previous summary.
   * Sends only new messages + previous summary to the LLM, avoiding re-processing old context.
   */
  static async incrementalSummarizeConversation(
    chatName: string,
    messages: Array<{ sender: string; body: string; timestamp: Date }>,
    previousSummary: string,
    previousPriority: string,
    previousActionItems: string,
    founderContext = '',
  ): Promise<SummaryOutput> {
    const startTime = Date.now();
    logger.info({ chatName, isMocked: isMockLLM }, 'AIService: incremental digesting conversation');

    if (isMockLLM) {
      await new Promise((r) => setTimeout(r, 400));
      const bodiesCombined = messages.map((m) => m.body).join(' ').toLowerCase();
      const hasNewAction = ['urgent', 'asap', 'please', 'need', 'help', 'meeting', 'call', 'deadline'].some(k => bodiesCombined.includes(k));

      return {
        chatName,
        summary: hasNewAction
          ? `${previousSummary} Additionally, new messages indicate further action required.`
          : previousSummary,
        priority: hasNewAction && previousPriority !== 'urgent' ? 'high' : (previousPriority as any),
        category: 'Conversation',
        sentiment: 'neutral',
        action_items: hasNewAction
          ? [{ task: 'Review new messages and respond accordingly', owner: 'Founder', deadline: null }]
          : [],
        requires_founder: hasNewAction,
        suggested_reply: hasNewAction ? 'Thank you for the update. I will review and get back to you shortly.' : null,
        pending_from_founder: hasNewAction
          ? [{ description: 'Review new messages and respond accordingly', due_date: null }]
          : [],
      };
    }

    try {
      const systemContent = incrementalSummarizeConversationPrompt
        .replace('{{previousSummary}}', previousSummary)
        .replace('{{previousPriority}}', previousPriority)
        .replace('{{previousActionItems}}', previousActionItems);

      const response = await this.callLLM(async (client, model) => {
        return client.chat.completions.create({
          model: model,
          messages: [
            { role: 'system', content: systemContent },
            {
              role: 'user', content: `Chat Name: ${chatName}\n${founderContext.length > 0 ? `Founder's personal context for this chat (actively watch for these):\n${founderContext}\n` : ''}\nNew Messages:\n${messages.map((m) => {
                const ts = typeof m.timestamp === 'string' ? m.timestamp : (m.timestamp instanceof Date ? m.timestamp.toISOString() : new Date(m.timestamp).toISOString());
                return `[${ts}] ${m.sender}: ${m.body}`;
              }).join('\n')}`
            },
          ],
          temperature: 0.1,
        });
      });

      const latency = Date.now() - startTime;
      logger.info({ latency }, 'Real LLM incremental summarization completed');

      const rawContent = response.choices[0]?.message?.content || '';
      const cleanJson = this.cleanJsonString(rawContent);
      return JSON.parse(cleanJson) as SummaryOutput;
    } catch (err: any) {
      logger.error({ error: err.message }, 'Real LLM incremental summarization failed');
      throw err;
    }
  }

  /**
   * Generates morning briefing. Uses mock template filler if key is unconfigured.
   */
  static async generateFounderBrief(context: {
    meetings: string;
    whatsappDigests: string;
    unreadEmails: string;
    pendingTasks: string;
    pendingFromFounder: string;
  }): Promise<string> {
    const startTime = Date.now();
    logger.info({ isMocked: isMockLLM }, 'AIService: generating morning brief');

    if (isMockLLM) {
      await new Promise((r) => setTimeout(r, 600));
      const now = new Date();
      return `# Morning Briefing - ${now.toLocaleDateString()}

## 📅 Today's Schedule & Meetings
- ${context.meetings}

## 🚨 Urgent Matters (Requires Immediate Attention)
- **WhatsApp**: Rahul (Investor) requested Q3 growth figures and updated pitch deck revenue numbers.
- **Email**: Stripe Support requested verification documents within 48 hours to prevent account lockout.

## 💬 High-Priority Conversations
- **Rahul (Investor)**: Active discussions regarding Q3 slide deck valuations. Suggested reply prepared.

## 📋 Pending Action Items & Tasks
- [PENDING] Update pitch deck with latest revenue run-rate (Due: Tomorrow, Source: WhatsApp)
- [PENDING] Prepare Q3 valuations & growth slide deck figures (Due: Tomorrow, Source: WhatsApp)

## ⏳ What I Owe (Pending From Me)
${context.pendingFromFounder}

## 🎯 Suggested Focus Areas for Today
1. Update pitch deck revenue run-rates before the 10:00 AM call.
2. Complete Stripe document uploads to avoid payout disruption.
3. Review staging server deployment issues with Amit.
`;
    }

    try {
      const systemPrompt = generateBriefPrompt
        .replace('{meetings}', context.meetings)
        .replace('{whatsappDigests}', context.whatsappDigests)
        .replace('{unreadEmails}', context.unreadEmails)
        .replace('{pendingTasks}', context.pendingTasks)
        .replace('{pendingFromFounder}', context.pendingFromFounder);

      const response = await this.callLLM(async (client, model) => {
        return client.chat.completions.create({
          model: model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: 'Generate briefing now.' },
          ],
          temperature: 0.7,
        });
      });

      return response.choices[0]?.message?.content || '';
    } catch (err: any) {
      logger.error({ error: err.message }, 'Real LLM brief generation failed');
      throw err;
    }
  }

  /**
   * Generates evening daily summary.
   */
  static async generateDailySummary(context: {
    messagesCount: number;
    importantConversations: string;
    tasksCreated: string;
    pendingApprovals: string;
  }): Promise<string> {
    logger.info({ isMocked: isMockLLM }, 'AIService: generating EOD summary');

    if (isMockLLM) {
      await new Promise((r) => setTimeout(r, 600));
      const now = new Date();
      return `# End of Day Summary - ${now.toLocaleDateString()}

## 📊 Daily Activity Metrics
- WhatsApp Messages processed: ${context.messagesCount}
- Sync status: Checked staging server logs, synced 2 unread investor emails.

## 🔑 Key Conversations & Updates
${context.importantConversations}

## 🛠 Tasks Captured Today
${context.tasksCreated}

## ⚠️ Risks & Pending Action Items
${context.pendingApprovals}

## 🌅 Tomorrow's Priorities
1. Prepare slides for the product demo scheduled next week.
2. Verify migrations on staging server with Neha.
`;
    }

    try {
      const systemPrompt = generateDailySummaryPrompt
        .replace('{messagesCount}', String(context.messagesCount))
        .replace('{importantConversations}', context.importantConversations)
        .replace('{tasksCreated}', context.tasksCreated)
        .replace('{pendingApprovals}', context.pendingApprovals);

      const response = await this.callLLM(async (client, model) => {
        return client.chat.completions.create({
          model: model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: 'Generate EOD summary now.' },
          ],
          temperature: 0.5,
        });
      });

      return response.choices[0]?.message?.content || '';
    } catch (err: any) {
      logger.error({ error: err.message }, 'Real LLM summary generation failed');
      throw err;
    }
  }

  /**
   * Answers founder queries. Evaluates keywords to return matching mock answers.
   */
  static async answerFounderQuestion(
    question: string,
    context: { digests: string; tasks: string; metadata: string }
  ): Promise<string> {
    logger.info({ question, isMocked: isMockLLM }, 'AIService: answering question');

    if (isMockLLM) {
      await new Promise((r) => setTimeout(r, 500));
      const q = question.toLowerCase();

      if (q.includes('rahul') || q.includes('investor') || q.includes('growth') || q.includes('val')) {
        return `Sir, Rahul (Investor) sent messages asking for the updated Q3 growth metrics and revised pitch deck. He proposed a review call for tomorrow at 10:00 AM. 

I have created two tasks for you:
1. "Update pitch deck with latest revenue run-rate" (Due tomorrow)
2. "Prepare Q3 valuations & growth slide deck figures" (Due tomorrow)

Would you like me to draft a confirmation reply to his messages?`;
      }

      if (q.includes('stripe') || q.includes('verify') || q.includes('identity')) {
        return `Yes, sir. You received an urgent email from Stripe Support (support@stripe.com) requesting identity verification documents. 

They noted that if documents are not submitted within 48 hours, payouts may be restricted. I have flagged this as an urgent pending item on your checklist.`;
      }

      if (q.includes('task') || q.includes('todo') || q.includes('do today') || q.includes('action')) {
        return `You have 2 pending tasks captured from WhatsApp and 1 from emails:
1. **[Urgent]** Update pitch deck with latest revenue run-rate (Source: Rahul)
2. **[Urgent]** Upload identity verification documents to Stripe (Source: Stripe support email)
3. **[Medium]** Review locked database connection logs on staging server (Source: Ops team chat)`;
      }

      if (q.includes('staging') || q.includes('db') || q.includes('ops') || q.includes('migration')) {
        return `Neha and Amit reported on the Ops group chat that database migrations are failing on the staging server because of connection locking. Amit asked if you could take a look at the database logs.`;
      }

      return `I see recent activity involving:
- **Rahul (Investor)**: Q3 metrics request and call scheduled for tomorrow.
- **Stripe**: Identity verification required within 48 hours.
- **Ops Group**: Staging migration DB pool locking issue.

Please let me know which of these you would like more detail on, sir.`;
    }

    try {
      const systemPrompt = answerFounderQuestionPrompt
        .replace('{digests}', context.digests)
        .replace('{tasks}', context.tasks)
        .replace('{metadata}', context.metadata)
        .replace('{question}', question);

      const response = await this.callLLM(async (client, model) => {
        return client.chat.completions.create({
          model: model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: question },
          ],
          temperature: 0.3,
        });
      });

      return response.choices[0]?.message?.content || '';
    } catch (err: any) {
      logger.error({ error: err.message }, 'Real LLM Q&A failed');
      throw err;
    }
  }

  /**
   * Classifies estimate comments for Intent Score.
   */
  static async classifyEstimateComments(
    custName: string,
    total: number,
    commentsHistory: string,
    estimateDate: string
  ): Promise<any> {
    const todayStr = new Date().toISOString().split('T')[0];
    logger.info({ custName, isMocked: isMockLLM }, 'AIService: classifying estimate comments');

    if (isMockLLM) {
      await new Promise((r) => setTimeout(r, 300));
      return {
        meaningful_update: false,
        follow_up_missing: false,
        not_answering: false,
        improper_follow_up: false,
        last_comment_not_satisfactory: true,
        day_exceeded: true,
        moving_slow: "No",
        under_discussion: "No",
        confirm: "No",
        intent_score: 2,
        reasoning: "Latest comment is older than 2 days.",
        summary: "Timeline sync has basic comments history."
      };
    }

    try {
      const systemPrompt = classifyEstimatePrompt.replace(/{today}/g, todayStr);
      const userMessage = `Customer Name: ${custName}\nTotal Amount: ${total}\nEstimate Created Date: ${estimateDate}\n\nComment History:\n${commentsHistory}`;

      const response = await this.callLLM(async (client, model) => {
        return client.chat.completions.create({
          model: model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage },
          ],
          temperature: 0,
        });
      });

      const cleanJson = this.cleanJsonString(response.choices[0]?.message?.content || '');
      return JSON.parse(cleanJson);
    } catch (err: any) {
      logger.error({ error: err.message }, 'Real LLM classification failed');
      throw err;
    }
  }

  /**
   * Extracts enquiry details and date from comment history.
   */
  static async extractEnquiryAndDate(commentsHistory: string): Promise<{ enquiry: string; date: string; is_enquiry: boolean }> {
    const currentYear = String(new Date().getFullYear());
    logger.info({ isMocked: isMockLLM }, 'AIService: extracting enquiry details');

    if (isMockLLM) {
      await new Promise((r) => setTimeout(r, 200));
      if (commentsHistory.toLowerCase().includes('inquiry') || commentsHistory.toLowerCase().includes('enquiry')) {
        return {
          enquiry: "Inquiry 9 - 18 June",
          date: "2026-06-18",
          is_enquiry: true
        };
      }
      return {
        enquiry: "",
        date: "",
        is_enquiry: false
      };
    }

    try {
      const systemPrompt = extractEnquiryPrompt.replace(/{currentYear}/g, currentYear);
      const response = await this.callLLM(async (client, model) => {
        return client.chat.completions.create({
          model: model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: `Comments summary: ${commentsHistory}` },
          ],
          temperature: 0,
        });
      });

      const cleanJson = this.cleanJsonString(response.choices[0]?.message?.content || '');
      return JSON.parse(cleanJson);
    } catch (err: any) {
      logger.error({ error: err.message }, 'Real LLM enquiry extraction failed');
      throw err;
    }
  }

  /**
   * Matches estimate to Business ID using candidate records.
   */
  static async matchBusinessEntity(
    customerName: string,
    location: string,
    lineItems: string,
    candidateNotionPages: string
  ): Promise<{ id: string }> {
    logger.info({ customerName, isMocked: isMockLLM }, 'AIService: matching business entity');

    if (isMockLLM) {
      await new Promise((r) => setTimeout(r, 200));
      return { id: "" };
    }

    try {
      const userMessage = `To find ID for the business : -\nName : ${customerName}\nLocation : ${location}\nItem in estimate : -\n${lineItems}\n\nBusiness lookup below : -\n${candidateNotionPages}`;

      const response = await this.callLLM(async (client, model) => {
        return client.chat.completions.create({
          model: model,
          messages: [
            { role: 'system', content: matchBusinessPrompt },
            { role: 'user', content: userMessage },
          ],
          temperature: 0,
        });
      });

      const cleanJson = this.cleanJsonString(response.choices[0]?.message?.content || '');
      return JSON.parse(cleanJson);
    } catch (err: any) {
      logger.error({ error: err.message }, 'Real LLM business matching failed');
      throw err;
    }
  }

  /**
   * Classifies a single WhatsApp message as Pending / Not Pending via LLM.
   */
  static async classifyMessage(context: {
    sender: string;
    body: string;
    timestamp: string;
    conversationContext: string;
  }): Promise<{
    is_pending: boolean;
    confidence: 'high' | 'medium' | 'low';
    reason: string;
    suggested_action: string | null;
    priority: 'low' | 'medium' | 'high' | 'urgent';
    category: string;
  }> {
    logger.info({ sender: context.sender, body: context.body.substring(0, 80) }, 'AIService: classifying message');

    if (isMockLLM) {
      await new Promise((r) => setTimeout(r, 300));
      const lower = context.body.toLowerCase();
      const hasPendingKeyword = ['urgent', 'asap', 'please', 'need', 'help', 'issue', 'problem', 'broken', 'when', 'how much', 'quote', 'price', 'order', 'complaint', 'request'].some(k => lower.includes(k));
      const isQuestion = context.body.includes('?');

      if (hasPendingKeyword || isQuestion) {
        return {
          is_pending: true,
          confidence: 'medium',
          reason: hasPendingKeyword ? 'Message contains keywords indicating a request or action item.' : 'Message is a question requiring a response.',
          suggested_action: 'Review and respond to the sender.',
          priority: lower.includes('urgent') ? 'urgent' : 'medium',
          category: 'Customer',
        };
      }

      return {
        is_pending: false,
        confidence: 'medium',
        reason: 'Message appears informational with no action required.',
        suggested_action: null,
        priority: 'low',
        category: 'Informational',
      };
    }

    try {
      const userMessage = `Sender: ${context.sender}\nTimestamp: ${context.timestamp}\nMessage: ${context.body}\n\nConversation Context:\n${context.conversationContext || 'No recent context'}`;

      const response = await this.callLLM(async (client, model) => {
        return client.chat.completions.create({
          model: model,
          messages: [
            { role: 'system', content: classifyMessagePrompt },
            { role: 'user', content: userMessage },
          ],
          temperature: 0.1,
        });
      });

      const cleanJson = this.cleanJsonString(response.choices[0]?.message?.content || '');
      return JSON.parse(cleanJson);
    } catch (err: any) {
      logger.error({ error: err.message }, 'Real LLM message classification failed');
      throw err;
    }
  }

  /**
   * Queries the Company Brain — synthesizes a natural language answer from
   * retrieved context entries across all data sources.
   */
  static async queryBrain(question: string, contextText: string): Promise<string> {
    logger.info({ question: question.substring(0, 80) }, 'AIService: querying company brain');

    if (isMockLLM) {
      await new Promise((r) => setTimeout(r, 500));
      return `**Answer**: Based on the indexed context, I found relevant information regarding your query about "${question}".

**Sources**: WHATSAPP, DIGEST

**Open Items**: None — this is a mock response. Configure a real LLM API key to get actual synthesis.`;
    }

    try {
      const today = new Date().toISOString().split('T')[0];
      const systemPrompt = brainQueryPrompt
        .replace('{context}', contextText)
        .replace('{today}', today)
        .replace('{question}', question);

      const response = await this.callLLM(async (client, model) => {
        return client.chat.completions.create({
          model: model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: question },
          ],
          temperature: 0.2,
        });
      });

      return response.choices[0]?.message?.content || 'No response generated.';
    } catch (err: any) {
      logger.error({ error: err.message }, 'AIService: Brain query failed');
      throw err;
    }
  }
}
export default AIService;

