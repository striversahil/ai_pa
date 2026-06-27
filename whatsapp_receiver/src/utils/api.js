import { createClient } from '@supabase/supabase-js';

// Keys for LocalStorage
const STORAGE_KEYS = {
  SUPABASE_URL: 'pa_manager_sb_url',
  SUPABASE_KEY: 'pa_manager_sb_key',
  GROQ_KEY: 'pa_manager_groq_key',
  ENQUIRIES: 'pa_manager_enquiries',
  NOTES: 'pa_manager_notes'
};

// Initial Mock Data
const INITIAL_ENQUIRIES = [
  {
    id: 'enq-1',
    enquiry: 'Urgent: Bulk order of 150 Ergonomic Mesh Office Chairs',
    party_name: 'Apex Infotech Solutions',
    product_quoted: 'ErgoSoft Prime Mesh (Black)',
    image_url: 'https://images.unsplash.com/photo-1505797149-43b0069ec26b?auto=format&fit=crop&w=300&q=80',
    action_status: 'Pending',
    estimate_name: 'EST-2026-0892',
    estimate_comment: 'Awaiting pricing approvals from supply chain partners.',
    created_at: new Date().toISOString()
  },
  {
    id: 'enq-2',
    enquiry: 'Custom design of glass conference table with cable management',
    party_name: 'Vortex Venture Capital',
    product_quoted: '12-Seater Tempered Glass Boardroom Table',
    image_url: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=300&q=80',
    action_status: 'In Progress',
    estimate_name: 'EST-2026-0911',
    estimate_comment: 'Shared initial mockups. Customer requested 2 hidden sockets.',
    created_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString() // Yesterday
  },
  {
    id: 'enq-3',
    enquiry: 'Routine furniture refurbishment for reception lounge area',
    party_name: 'Starlight Medical Center',
    product_quoted: 'Sleek Leatherette 3-Seater Sofas & Coffee Tables',
    image_url: '',
    action_status: 'Quoted',
    estimate_name: 'EST-2026-0744',
    estimate_comment: 'Estimate sent on Monday. Follow-up scheduled for Friday.',
    created_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString() // 3 days ago
  }
];

const INITIAL_EMAILS = [
  {
    id: 'em-1',
    client_name: 'Apex Infotech Solutions',
    sender: 'Sarah Jenkins <sjenkins@apexinfo.com>',
    subject: 'RE: Quotation for ErgoSoft Prime Chairs',
    snippet: 'Thanks for the pricing details. Can we get an additional 5% discount if we place...',
    body: 'Hi Personal Assistant,\n\nThanks for sending over the initial quotation. We are reviewing the package internally.\n\nCould you please let us know if there is any scope for a volume-based discount? An additional 5% discount on the ErgoSoft Prime model would help us close this deal by tomorrow afternoon.\n\nBest regards,\nSarah Jenkins\nProcurement Manager, Apex Infotech Solutions',
    category: 'Urgent',
    received_at: new Date().toISOString()
  },
  {
    id: 'em-2',
    client_name: 'Apex Infotech Solutions',
    sender: 'IT Department <support@apexinfo.com>',
    subject: 'Specification sheet for conference seating',
    snippet: 'Could you share the load capacity and warranty terms for the Mesh series?',
    body: 'Hello Team,\n\nBefore we issue the Purchase Order, our HSE compliance team requires the certified weight load capacities and structural certifications for the ErgoSoft Prime seating.\n\nPlease share the formal datasheet at your earliest convenience.\n\nThanks,\nRobert Davis\nIT & Facilities Lead',
    category: 'Inquiry',
    received_at: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString()
  },
  {
    id: 'em-3',
    client_name: 'Vortex Venture Capital',
    sender: 'David Vance <d.vance@vortex.vc>',
    subject: 'Feedback on glass conference table blueprints',
    snippet: 'Blueprints look great, but we want the cable box in matte black metal instead of silver.',
    body: 'Hi there,\n\nThe conference table designs are fantastic. We approve the dimensions.\n\nJust one minor detail: we would prefer the center pop-up media box to have a matte black powder-coated finish rather than the anodized aluminum silver to match our office partition columns.\n\nLet us know if this affects the lead time.\n\nCheers,\nDavid Vance',
    category: 'General',
    received_at: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString()
  },
  {
    id: 'em-4',
    client_name: 'Starlight Medical Center',
    sender: 'Dr. Evelyn Carter <e.carter@starlightmed.org>',
    subject: 'Payment receipt confirmation',
    snippet: 'Sent the advance wire transfer today. Please confirm receipt and share delivery date.',
    body: 'Dear Team,\n\nWe have initiated the 50% advance wire transfer of $4,850.00 to your bank account for the reception lobby sofas. The transaction receipt is attached.\n\nPlease confirm when the funds reflect and provide an approximate delivery date so we can coordinate building access.\n\nWarm regards,\nDr. Evelyn Carter',
    category: 'Support',
    received_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString()
  }
];

const INITIAL_NOTES = [
  {
    id: 'note-1',
    title: 'Groq System Prompt Rules',
    content: 'Always format LLM output as structured JSON. Specify fields explicitly (summary, actionItems, sentiment, replyDraft). Use llama-3.3-70b-versatile for high reasoning quality.',
    tags: ['AI', 'Prompts', 'Groq'],
    created_at: new Date().toISOString()
  },
  {
    id: 'note-2',
    title: 'Supabase RLS Policy Boilerplate',
    content: 'CREATE POLICY "Allow public read" ON enquiries FOR SELECT USING (true);\nCREATE POLICY "Allow authenticated edits" ON enquiries FOR ALL TO authenticated USING (true);',
    tags: ['Database', 'Supabase', 'SQL'],
    created_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  },
  {
    id: 'note-3',
    title: 'Client pricing guidelines 2026',
    content: '- Furniture: Max discount 8% for order size > 100 units.\n- Custom table designs: Minimum $1,500 base price.\n- Freight delivery charges included for regional clients only.',
    tags: ['Sales', 'Pricing'],
    created_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString()
  }
];

// Helper to initialize Supabase
let supabaseInstance = null;

export function getCredentials() {
  return {
    supabaseUrl: localStorage.getItem(STORAGE_KEYS.SUPABASE_URL) || '',
    supabaseKey: localStorage.getItem(STORAGE_KEYS.SUPABASE_KEY) || '',
    groqKey: localStorage.getItem(STORAGE_KEYS.GROQ_KEY) || ''
  };
}

export function saveCredentials(supabaseUrl, supabaseKey, groqKey) {
  if (supabaseUrl) localStorage.setItem(STORAGE_KEYS.SUPABASE_URL, supabaseUrl.trim());
  else localStorage.removeItem(STORAGE_KEYS.SUPABASE_URL);

  if (supabaseKey) localStorage.setItem(STORAGE_KEYS.SUPABASE_KEY, supabaseKey.trim());
  else localStorage.removeItem(STORAGE_KEYS.SUPABASE_KEY);

  if (groqKey) localStorage.setItem(STORAGE_KEYS.GROQ_KEY, groqKey.trim());
  else localStorage.removeItem(STORAGE_KEYS.GROQ_KEY);

  // Re-evaluate client connection
  supabaseInstance = null;
}

export function isRealMode() {
  const creds = getCredentials();
  return !!(creds.supabaseUrl && creds.supabaseKey);
}

function getSupabaseClient() {
  if (!isRealMode()) return null;
  if (!supabaseInstance) {
    const creds = getCredentials();
    supabaseInstance = createClient(creds.supabaseUrl, creds.supabaseKey);
  }
  return supabaseInstance;
}

// ----------------------------------------------------
// SCREEN 1: ENQUIRIES & ESTIMATES API
// ----------------------------------------------------

export async function fetchEnquiries(dayFilter = 'All') {
  if (isRealMode()) {
    try {
      const supabase = getSupabaseClient();
      let query = supabase.from('enquiries').select('*').order('created_at', { ascending: false });
      
      const now = new Date();
      if (dayFilter === 'Today') {
        const startOfDay = new Date(now.setHours(0,0,0,0)).toISOString();
        query = query.gte('created_at', startOfDay);
      } else if (dayFilter === 'Yesterday') {
        const startOfYesterday = new Date(now.setDate(now.getDate() - 1));
        startOfYesterday.setHours(0,0,0,0);
        const endOfYesterday = new Date(now);
        endOfYesterday.setHours(23,59,59,999);
        query = query.gte('created_at', startOfYesterday.toISOString()).lte('created_at', endOfYesterday.toISOString());
      } else if (dayFilter === 'Last 7 Days') {
        const sevenDaysAgo = new Date(now.setDate(now.getDate() - 7)).toISOString();
        query = query.gte('created_at', sevenDaysAgo);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    } catch (e) {
      console.error('Supabase fetch error, fallback to mock data:', e);
    }
  }

  // Fallback to LocalStorage
  let localData = localStorage.getItem(STORAGE_KEYS.ENQUIRIES);
  if (!localData) {
    localStorage.setItem(STORAGE_KEYS.ENQUIRIES, JSON.stringify(INITIAL_ENQUIRIES));
    localData = JSON.stringify(INITIAL_ENQUIRIES);
  }
  
  let parsed = JSON.parse(localData);
  
  // Apply filtering logic locally
  const now = new Date();
  if (dayFilter === 'Today') {
    const start = new Date(now.setHours(0,0,0,0));
    return parsed.filter(item => new Date(item.created_at) >= start);
  } else if (dayFilter === 'Yesterday') {
    const startYest = new Date();
    startYest.setDate(startYest.getDate() - 1);
    startYest.setHours(0,0,0,0);
    const endYest = new Date();
    endYest.setDate(endYest.getDate() - 1);
    endYest.setHours(23,59,59,999);
    return parsed.filter(item => {
      const d = new Date(item.created_at);
      return d >= startYest && d <= endYest;
    });
  } else if (dayFilter === 'Last 7 Days') {
    const limit = new Date();
    limit.setDate(limit.getDate() - 7);
    return parsed.filter(item => new Date(item.created_at) >= limit);
  }
  
  return parsed;
}

export async function createEnquiry(enquiryData) {
  const newRow = {
    ...enquiryData,
    id: 'enq-' + Math.random().toString(36).substr(2, 9),
    created_at: new Date().toISOString()
  };

  if (isRealMode()) {
    try {
      const supabase = getSupabaseClient();
      // omit local-only ID for insert if database auto-generates uuid
      const { id, ...supabaseData } = newRow;
      const { data, error } = await supabase.from('enquiries').insert([supabaseData]).select();
      if (error) throw error;
      return data[0];
    } catch (e) {
      console.error('Supabase insert error, fallback to mock:', e);
    }
  }

  const list = await fetchEnquiries('All');
  list.unshift(newRow);
  localStorage.setItem(STORAGE_KEYS.ENQUIRIES, JSON.stringify(list));
  return newRow;
}

export async function updateEnquiry(id, updateData) {
  if (isRealMode()) {
    try {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase.from('enquiries').update(updateData).eq('id', id).select();
      if (error) throw error;
      // In case ID schema matches uuid we return it
      if (data && data.length > 0) return data[0];
    } catch (e) {
      console.error('Supabase update error, fallback to mock:', e);
    }
  }

  const list = await fetchEnquiries('All');
  const index = list.findIndex(item => item.id === id);
  if (index !== -1) {
    list[index] = { ...list[index], ...updateData };
    localStorage.setItem(STORAGE_KEYS.ENQUIRIES, JSON.stringify(list));
    return list[index];
  }
  return null;
}

export async function deleteEnquiry(id) {
  if (isRealMode()) {
    try {
      const supabase = getSupabaseClient();
      const { error } = await supabase.from('enquiries').delete().eq('id', id);
      if (error) throw error;
      return true;
    } catch (e) {
      console.error('Supabase delete error, fallback to mock:', e);
    }
  }

  const list = await fetchEnquiries('All');
  const filtered = list.filter(item => item.id !== id);
  localStorage.setItem(STORAGE_KEYS.ENQUIRIES, JSON.stringify(filtered));
  return true;
}

// ----------------------------------------------------
// SCREEN 2: EMAIL INBOX API
// ----------------------------------------------------

export async function fetchClientNames() {
  // Extract distinct client names from enquiries and mock emails
  const enquiries = await fetchEnquiries('All');
  const names = new Set();
  
  enquiries.forEach(e => {
    if (e.party_name) names.add(e.party_name.trim());
  });
  
  INITIAL_EMAILS.forEach(em => {
    names.add(em.client_name.trim());
  });
  
  return Array.from(names);
}

export async function fetchEmailsForClient(clientName) {
  if (isRealMode()) {
    try {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from('emails')
        .select('*')
        .eq('client_name', clientName)
        .order('received_at', { ascending: false });
      
      if (error) throw error;
      // If we find emails in Supabase, return them
      if (data && data.length > 0) return data;
    } catch (e) {
      console.error('Supabase fetch emails failed:', e);
    }
  }

  // Local Mock fallback filtering by Client Name
  return INITIAL_EMAILS.filter(email => email.client_name.toLowerCase() === clientName.toLowerCase());
}

// ----------------------------------------------------
// SCREEN 3: QUICK NOTES API
// ----------------------------------------------------

export async function fetchNotes() {
  if (isRealMode()) {
    try {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase.from('notes').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    } catch (e) {
      console.error('Supabase fetch notes error, fallback to mock:', e);
    }
  }

  let localData = localStorage.getItem(STORAGE_KEYS.NOTES);
  if (!localData) {
    localStorage.setItem(STORAGE_KEYS.NOTES, JSON.stringify(INITIAL_NOTES));
    localData = JSON.stringify(INITIAL_NOTES);
  }
  return JSON.parse(localData);
}

export async function createNote(noteData) {
  const newNote = {
    ...noteData,
    id: 'note-' + Math.random().toString(36).substr(2, 9),
    created_at: new Date().toISOString()
  };

  if (isRealMode()) {
    try {
      const supabase = getSupabaseClient();
      const { id, ...supabaseData } = newNote;
      const { data, error } = await supabase.from('notes').insert([supabaseData]).select();
      if (error) throw error;
      return data[0];
    } catch (e) {
      console.error('Supabase insert note error:', e);
    }
  }

  const list = await fetchNotes();
  list.unshift(newNote);
  localStorage.setItem(STORAGE_KEYS.NOTES, JSON.stringify(list));
  return newNote;
}

export async function updateNote(id, updateData) {
  if (isRealMode()) {
    try {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase.from('notes').update(updateData).eq('id', id).select();
      if (error) throw error;
      if (data && data.length > 0) return data[0];
    } catch (e) {
      console.error('Supabase update note error:', e);
    }
  }

  const list = await fetchNotes();
  const index = list.findIndex(item => item.id === id);
  if (index !== -1) {
    list[index] = { ...list[index], ...updateData };
    localStorage.setItem(STORAGE_KEYS.NOTES, JSON.stringify(list));
    return list[index];
  }
  return null;
}

export async function deleteNote(id) {
  if (isRealMode()) {
    try {
      const supabase = getSupabaseClient();
      const { error } = await supabase.from('notes').delete().eq('id', id);
      if (error) throw error;
      return true;
    } catch (e) {
      console.error('Supabase delete note error:', e);
    }
  }

  const list = await fetchNotes();
  const filtered = list.filter(item => item.id !== id);
  localStorage.setItem(STORAGE_KEYS.NOTES, JSON.stringify(filtered));
  return true;
}

// ----------------------------------------------------
// GROQ AI INFERENCE CLIENT
// ----------------------------------------------------

async function callGroqAI(prompt, systemInstruction = '', responseFormatJson = false) {
  const creds = getCredentials();
  
  if (!creds.groqKey) {
    // Return empty token indicator
    throw new Error('GROQ_KEY_MISSING');
  }

  const payload = {
    model: 'llama-3.3-70b-versatile',
    messages: [
      ...(systemInstruction ? [{ role: 'system', content: systemInstruction }] : []),
      { role: 'user', content: prompt }
    ],
    temperature: 0.2
  };

  if (responseFormatJson) {
    payload.response_format = { type: 'json_object' };
  }

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${creds.groqKey}`
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Groq API error: ${response.status} - ${errText}`);
  }

  const resJson = await response.json();
  return resJson.choices[0].message.content;
}

// Screen 1: Generate Comment for Estimate
export async function aiGenerateEstimateComment(partyName, productQuoted, estimateName) {
  try {
    const prompt = `Generate a single concise, professional comment/remark for an estimate. 
Client Party: ${partyName}
Product Quoted: ${productQuoted}
Estimate Code: ${estimateName}

The comment should be polite and suitable to put into a project tracker. Keep it strictly under 15 words. Don't write anything else, just the comment string.`;

    const system = 'You are a helpful office manager assistant. Provide only the text for the comment.';
    const result = await callGroqAI(prompt, system, false);
    return result.replace(/^"|"$/g, '').trim(); // strip outer quotes if any
  } catch (err) {
    if (err.message === 'GROQ_KEY_MISSING') {
      // Return simulated comment
      return `[Mock AI] Spec proposal sent for ${productQuoted || 'product'}. Awaiting pricing review from ${partyName || 'client'}.`;
    }
    console.error('Groq AI error:', err);
    return 'Proposal prepared and submitted. Review set for next week.';
  }
}

// Screen 2: Generate Email Inbox Summary for Client
export async function aiGenerateEmailSummary(clientName, emails) {
  const emailsText = emails.map((e, index) => `
--- EMAIL #${index + 1} ---
Sender: ${e.sender}
Subject: ${e.subject}
Date: ${e.received_at}
Content: ${e.body}
`).join('\n');

  try {
    const system = 'You are an expert executive email analyst. You must analyze the emails and return a JSON object with the following fields:\n' +
      '- "executiveSummary" (string, max 2 sentences summarizing what the client needs/wants)\n' +
      '- "actionItems" (array of strings, listing the next steps needed by the assistant)\n' +
      '- "sentiment" (string, must be one of "Positive", "Neutral", "Urgent", or "Frustrated")\n' +
      '- "replyDraft" (string, a professional email reply draft addressing the client\'s queries)';
      
    const prompt = `Analyze these emails from client "${clientName}":\n${emailsText}`;
    
    const responseText = await callGroqAI(prompt, system, true);
    return JSON.parse(responseText);
  } catch (err) {
    console.warn('Groq AI summary failed, using smart local summarizer:', err);
    
    // Smart offline mock summaries customized by client
    let mockResult = {
      executiveSummary: `Reviewing requirements for ${clientName}. The client is waiting for formal specification details and volume-based pricing adjustments.`,
      actionItems: [
        'Check inventory availability & production lead times.',
        'Request structural/weight certifications from HSE team.',
        'Send volume discount breakdown (e.g. 5% off list price).'
      ],
      sentiment: 'Neutral',
      replyDraft: `Subject: RE: Spec Sheet and Pricing Review\n\nDear Team,\n\nThank you for reaching out. We have received your query regarding the specifications and additional terms. I am coordinating with our logistics and supply chain leads and will provide the requested documents and updated pricing by tomorrow morning.\n\nBest regards,\nPersonal Assistant`
    };

    if (clientName.includes('Apex')) {
      mockResult.sentiment = 'Urgent';
      mockResult.executiveSummary = 'Apex Infotech Solutions has requested a 5% volume discount to finalize their 150-chair order, and needs specification sheets for weight load compliance.';
      mockResult.actionItems = [
        'Obtain approval for a 5% discount on ErgoSoft Prime chairs.',
        'Gather HSE load capacity sheets for conference seating.',
        'Draft and send the finalized sales agreement.'
      ];
      mockResult.replyDraft = `Subject: RE: Quotation for ErgoSoft Prime Chairs - Apex Infotech\n\nDear Sarah,\n\nThank you for the update. I have forwarded your request for the volume discount to our regional sales director for quick approval. Additionally, I am attaching the HSE load capacity and structural compliance sheets for the ErgoSoft Mesh series.\n\nI will get back to you with the finalized proposal within the next few hours to help close the order by tomorrow.\n\nBest regards,\nPersonal Assistant`;
    } else if (clientName.includes('Vortex')) {
      mockResult.sentiment = 'Positive';
      mockResult.executiveSummary = 'Vortex approved the boardroom table designs, but requested the pop-up cable box color be changed from silver to matte black.';
      mockResult.actionItems = [
        'Update technical table blueprint with matte black metal media box.',
        'Verify with engineering if this changes the estimated 3-week delivery lead time.'
      ];
      mockResult.replyDraft = `Subject: RE: Boardroom Table Blueprints - Vortex Venture\n\nHi David,\n\nExcellent, glad to hear the dimensions work! I have noted your preference for the matte black finish on the center media box. Our engineering team has updated the specs accordingly without affecting the 3-week delivery timeline.\n\nI will send over the updated sales invoice shortly.\n\nBest regards,\nPersonal Assistant`;
    } else if (clientName.includes('Starlight')) {
      mockResult.sentiment = 'Positive';
      mockResult.executiveSummary = 'Starlight Medical Center sent the 50% advance wire transfer of $4,850 and is waiting for payment confirmation and delivery logistics.';
      mockResult.actionItems = [
        'Verify bank deposit of $4,850.00 wire transfer.',
        'Confirm order schedule and coordinate delivery access with Starlight facilities team.'
      ];
      mockResult.replyDraft = `Subject: RE: Payment Confirmation - Starlight Medical\n\nDear Dr. Carter,\n\nWe confirm receipt of the wire transaction receipt and are tracking the deposit. The production of your reception lounge furniture is on track, and we expect delivery by June 25th. We will coordinate with your facilities team regarding building access.\n\nThank you for your business!\n\nBest regards,\nPersonal Assistant`;
    }

    // Add a slight delay to simulate network call
    await new Promise(resolve => setTimeout(resolve, 800));
    return mockResult;
  }
}

// Screen 3: Enhance Note with AI (Auto Tagging and Action Item extraction)
export async function aiEnhanceNote(noteTitle, noteContent) {
  try {
    const system = 'You are a productivity organizer assistant. You must analyze the note and return a JSON object with the following fields:\n' +
      '- "suggestedTitle" (string, a clean title for the note if it is vague or empty)\n' +
      '- "tags" (array of strings, max 3 clean, single-word tags)\n' +
      '- "checklist" (array of strings, action items/todos extracted from the note content, or empty array if none found)';

    const prompt = `Analyze this note:\nTitle: ${noteTitle}\nContent: ${noteContent}`;
    const responseText = await callGroqAI(prompt, system, true);
    return JSON.parse(responseText);
  } catch (err) {
    console.warn('Groq AI enhancement failed, using local rule-based extractor:', err);
    
    // Smart local fallback parsing
    const tags = [];
    const contentLower = noteContent.toLowerCase();
    
    if (contentLower.includes('database') || contentLower.includes('supabase') || contentLower.includes('sql')) {
      tags.push('Database', 'SQL');
    }
    if (contentLower.includes('ai') || contentLower.includes('prompt') || contentLower.includes('groq') || contentLower.includes('llm')) {
      tags.push('AI', 'Groq');
    }
    if (contentLower.includes('pricing') || contentLower.includes('price') || contentLower.includes('discount')) {
      tags.push('Sales', 'Pricing');
    }
    if (tags.length === 0) {
      tags.push('General', 'Task');
    }

    // Extract potential checklist items (lines starting with - or * or containing numbers/tasks)
    const checklist = [];
    const lines = noteContent.split('\n');
    lines.forEach(line => {
      const trimmed = line.trim();
      if (trimmed.startsWith('-') || trimmed.startsWith('*')) {
        checklist.push(trimmed.substring(1).trim());
      } else if (trimmed.toLowerCase().includes('todo') || trimmed.toLowerCase().includes('must') || trimmed.toLowerCase().includes('check')) {
        checklist.push(trimmed);
      }
    });

    if (checklist.length === 0 && noteContent.length > 10) {
      checklist.push('Review notes for actionable tasks');
    }

    await new Promise(resolve => setTimeout(resolve, 600));

    return {
      suggestedTitle: noteTitle || 'AI-Enhanced Quick Note',
      tags: tags.slice(0, 3),
      checklist: checklist
    };
  }
}
