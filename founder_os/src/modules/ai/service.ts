import OpenAI from 'openai';
import { config } from '../../config';
import { logger } from '../../shared/logger';
import { summarizeConversationPrompt } from './prompts/summarizeConversation';
import { generateBriefPrompt } from './prompts/generateBrief';
import { generateDailySummaryPrompt } from './prompts/generateDailySummary';
import { answerFounderQuestionPrompt } from './prompts/answerFounderQuestion';

// Determine if we should mock LLM responses
const isMockLLM = !config.LLM_API_KEY || config.LLM_API_KEY === 'your_api_key_here';

// Initialize client only if active keys exist (otherwise instantiate a placeholder object)
const openai = !isMockLLM
  ? new OpenAI({
      apiKey: config.LLM_API_KEY,
      baseURL: config.LLM_BASE_URL,
    })
  : null;

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
}

export class AIService {
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
    messages: Array<{ sender: string; body: string; timestamp: Date }>
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
      };
    }

    // Call Real LLM
    try {
      const response = await openai!.chat.completions.create({
        model: config.LLM_MODEL,
        messages: [
          { role: 'system', content: summarizeConversationPrompt },
          { role: 'user', content: `Chat Name: ${chatName}\n\nMessages:\n${messages.map((m) => `[${m.timestamp.toISOString()}] ${m.sender}: ${m.body}`).join('\n')}` },
        ],
        temperature: 0.1,
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
   * Generates morning briefing. Uses mock template filler if key is unconfigured.
   */
  static async generateFounderBrief(context: {
    meetings: string;
    whatsappDigests: string;
    unreadEmails: string;
    pendingTasks: string;
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
        .replace('{pendingTasks}', context.pendingTasks);

      const response = await openai!.chat.completions.create({
        model: config.LLM_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: 'Generate briefing now.' },
        ],
        temperature: 0.7,
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

      const response = await openai!.chat.completions.create({
        model: config.LLM_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: 'Generate EOD summary now.' },
        ],
        temperature: 0.5,
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

      const response = await openai!.chat.completions.create({
        model: config.LLM_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: question },
        ],
        temperature: 0.3,
      });

      return response.choices[0]?.message?.content || '';
    } catch (err: any) {
      logger.error({ error: err.message }, 'Real LLM Q&A failed');
      throw err;
    }
  }
}
export default AIService;
