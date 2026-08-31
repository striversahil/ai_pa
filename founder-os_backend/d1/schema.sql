-- founder-os D1 schema (SQLite) — port of Prisma models.
-- Enums → TEXT with CHECK, booleans → INTEGER 0/1, DateTime → TEXT (ISO 8601),
-- pgvector BrainContext.embedding dropped (D1 has no vector extension).

CREATE TABLE IF NOT EXISTS Contact (
  id TEXT PRIMARY KEY,
  chatId TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  pushName TEXT,
  phoneNumber TEXT NOT NULL,
  isGroup INTEGER NOT NULL DEFAULT 0,
  picture TEXT,
  lastMessageAt TEXT,
  lastMessageBody TEXT,
  unreadCount INTEGER NOT NULL DEFAULT 0,
  hasInbound INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_contact_name ON Contact(name);
CREATE INDEX IF NOT EXISTS idx_contact_lastMessageAt ON Contact(lastMessageAt);
CREATE INDEX IF NOT EXISTS idx_contact_isGroup ON Contact(isGroup);

CREATE TABLE IF NOT EXISTS Message (
  id TEXT PRIMARY KEY,
  wahaMessageId TEXT UNIQUE,
  chatId TEXT NOT NULL,
  sender TEXT NOT NULL,
  body TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  processed INTEGER NOT NULL DEFAULT 0,
  isHistorical INTEGER NOT NULL DEFAULT 0,
  quotedMessageId TEXT,
  quotedBody TEXT,
  quotedSender TEXT,
  mediaUrl TEXT,
  classification TEXT,
  classificationReason TEXT,
  classifiedAt TEXT,
  slaDeadline TEXT,
  createdAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_message_chatId ON Message(chatId);
CREATE INDEX IF NOT EXISTS idx_message_processed ON Message(processed);
CREATE INDEX IF NOT EXISTS idx_message_classification ON Message(classification);
CREATE INDEX IF NOT EXISTS idx_message_slaDeadline ON Message(slaDeadline);

CREATE TABLE IF NOT EXISTS OutboundIntent (
  id TEXT PRIMARY KEY,
  chatId TEXT NOT NULL,
  messageBody TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  targetDelayMs INTEGER,
  createdAt TEXT NOT NULL,
  enqueuedAt TEXT
);
CREATE INDEX IF NOT EXISTS idx_outboundintent_status ON OutboundIntent(status, createdAt);

CREATE TABLE IF NOT EXISTS Email (
  id TEXT PRIMARY KEY,
  subject TEXT NOT NULL,
  sender TEXT NOT NULL,
  body TEXT NOT NULL,
  processed INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_email_processed ON Email(processed);

CREATE TABLE IF NOT EXISTS Digest (
  id TEXT PRIMARY KEY,
  chatId TEXT NOT NULL,
  chatName TEXT NOT NULL,
  summary TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','urgent')),
  category TEXT NOT NULL,
  sentiment TEXT NOT NULL,
  requiresFounder INTEGER NOT NULL DEFAULT 0,
  suggestedReply TEXT,
  createdAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_digest_chatId ON Digest(chatId);

CREATE TABLE IF NOT EXISTS Task (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  owner TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','IN_PROGRESS','COMPLETED','CANCELLED')),
  deadline TEXT,
  source TEXT NOT NULL,
  sourceId TEXT,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ChatPendingItem (
  id TEXT PRIMARY KEY,
  chatId TEXT NOT NULL,
  chatName TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','DONE','CANCELLED')),
  dueDate TEXT,
  sourceMessageId TEXT,
  resolvedBy TEXT,
  createdAt TEXT NOT NULL,
  resolvedAt TEXT
);
CREATE INDEX IF NOT EXISTS idx_pending_chat_status ON ChatPendingItem(chatId, status);
CREATE INDEX IF NOT EXISTS idx_pending_status_created ON ChatPendingItem(status, createdAt);

CREATE TABLE IF NOT EXISTS ChatNote (
  chatId TEXT PRIMARY KEY,
  content TEXT NOT NULL DEFAULT '',
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS FounderNote (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS Estimate (
  estimateId TEXT PRIMARY KEY,
  estimateNumber TEXT NOT NULL,
  customerName TEXT NOT NULL,
  total REAL NOT NULL,
  date TEXT NOT NULL,
  status TEXT NOT NULL,
  lastSyncTime TEXT NOT NULL,
  skipMatching INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS Comment (
  commentId TEXT PRIMARY KEY,
  estimateId TEXT NOT NULL,
  description TEXT NOT NULL,
  commentedBy TEXT NOT NULL,
  date TEXT NOT NULL,
  dateDescription TEXT NOT NULL,
  dateFormatted TEXT,
  FOREIGN KEY (estimateId) REFERENCES Estimate(estimateId) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS Classification (
  estimateId TEXT PRIMARY KEY,
  meaningfulUpdate INTEGER NOT NULL DEFAULT 0,
  notAnswering TEXT,
  movingSlow TEXT,
  underDiscussion TEXT,
  confirm TEXT,
  intentScore INTEGER,
  reasoning TEXT,
  summary TEXT NOT NULL DEFAULT '',
  processedAt TEXT NOT NULL,
  FOREIGN KEY (estimateId) REFERENCES Estimate(estimateId) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS AuditLog (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  entityType TEXT NOT NULL,
  entityId TEXT,
  metadata TEXT,
  createdAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_action ON AuditLog(action);
CREATE INDEX IF NOT EXISTS idx_audit_entityType ON AuditLog(entityType);
CREATE INDEX IF NOT EXISTS idx_audit_createdAt ON AuditLog(createdAt);

CREATE TABLE IF NOT EXISTS BrainContext (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  sourceId TEXT NOT NULL,
  entityName TEXT,
  content TEXT NOT NULL,
  metadata TEXT,
  indexedAt TEXT NOT NULL,
  eventDate TEXT NOT NULL,
  UNIQUE(source, sourceId)
);
CREATE INDEX IF NOT EXISTS idx_brain_source ON BrainContext(source);
CREATE INDEX IF NOT EXISTS idx_brain_entity ON BrainContext(entityName);
CREATE INDEX IF NOT EXISTS idx_brain_eventDate ON BrainContext(eventDate);

CREATE TABLE IF NOT EXISTS Automation (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  type TEXT NOT NULL DEFAULT 'rule',
  triggerJson TEXT NOT NULL,
  conditionJson TEXT,
  actionsJson TEXT,
  configJson TEXT,
  dedupField TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  cooldownMs INTEGER NOT NULL DEFAULT 0,
  lastRunAt TEXT,
  runCount INTEGER NOT NULL DEFAULT 0,
  readmePath TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_automation_enabled ON Automation(enabled);

CREATE TABLE IF NOT EXISTS AutomationRun (
  id TEXT PRIMARY KEY,
  automationId TEXT NOT NULL,
  dedupKey TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'SUCCESS',
  payloadJson TEXT,
  error TEXT,
  createdAt TEXT NOT NULL,
  UNIQUE(automationId, dedupKey),
  FOREIGN KEY (automationId) REFERENCES Automation(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_automationrun_auto_created ON AutomationRun(automationId, createdAt);

CREATE TABLE IF NOT EXISTS PriceQuote (
  id TEXT PRIMARY KEY,
  messageId TEXT NOT NULL UNIQUE,
  dppChatId TEXT NOT NULL,
  itemName TEXT NOT NULL,
  unitPrice REAL,
  currency TEXT NOT NULL DEFAULT 'INR',
  rawLine TEXT NOT NULL,
  quotedAt TEXT NOT NULL,
  createdAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pricequote_chat ON PriceQuote(dppChatId);
CREATE INDEX IF NOT EXISTS idx_pricequote_quotedAt ON PriceQuote(quotedAt);

CREATE TABLE IF NOT EXISTS Setting (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS MarketingCampaign (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  type TEXT NOT NULL DEFAULT 'promotional',
  provider TEXT NOT NULL DEFAULT 'waba',
  status TEXT NOT NULL DEFAULT 'draft',
  scheduleType TEXT NOT NULL DEFAULT 'one_shot',
  scheduledAt TEXT,
  cron TEXT,
  timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  templateName TEXT,
  templateLanguage TEXT NOT NULL DEFAULT 'en',
  templateParams TEXT,
  messageBody TEXT,
  mediaUrl TEXT,
  mediaFilename TEXT,
  senderPhoneNumberId TEXT,
  aisensyCampaignName TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  lastRunAt TEXT,
  runCount INTEGER NOT NULL DEFAULT 0,
  statsJson TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_campaign_enabled ON MarketingCampaign(enabled, status);
CREATE INDEX IF NOT EXISTS idx_campaign_provider ON MarketingCampaign(provider);

CREATE TABLE IF NOT EXISTS MarketingLead (
  id TEXT PRIMARY KEY,
  campaignId TEXT NOT NULL,
  phoneNumber TEXT NOT NULL,
  name TEXT,
  attributes TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  messageId TEXT,
  error TEXT,
  sentAt TEXT,
  deliveredAt TEXT,
  readAt TEXT,
  createdAt TEXT NOT NULL,
  UNIQUE(campaignId, phoneNumber),
  FOREIGN KEY (campaignId) REFERENCES MarketingCampaign(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_lead_campaign_status ON MarketingLead(campaignId, status);

CREATE TABLE IF NOT EXISTS MarketingCampaignRun (
  id TEXT PRIMARY KEY,
  campaignId TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  total INTEGER NOT NULL DEFAULT 0,
  sent INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  skipped INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  startedAt TEXT NOT NULL,
  finishedAt TEXT,
  FOREIGN KEY (campaignId) REFERENCES MarketingCampaign(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_run_campaign ON MarketingCampaignRun(campaignId, startedAt);

-- Auth: Google-login users, sessions, category-based permissions
CREATE TABLE IF NOT EXISTS auth_user (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  picture TEXT,
  isRoot INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS auth_session (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL,
  expiresAt TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  FOREIGN KEY (userId) REFERENCES auth_user(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_auth_session_user ON auth_session(userId);
CREATE TABLE IF NOT EXISTS auth_scope (
  key TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  description TEXT
);
CREATE TABLE IF NOT EXISTS auth_user_scope (
  userId TEXT NOT NULL,
  scopeKey TEXT NOT NULL,
  PRIMARY KEY (userId, scopeKey),
  FOREIGN KEY (userId) REFERENCES auth_user(id) ON DELETE CASCADE,
  FOREIGN KEY (scopeKey) REFERENCES auth_scope(key) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS auth_role (
  key TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  description TEXT
);
CREATE TABLE IF NOT EXISTS auth_role_scope (
  roleKey TEXT NOT NULL,
  scopeKey TEXT NOT NULL,
  PRIMARY KEY (roleKey, scopeKey),
  FOREIGN KEY (roleKey) REFERENCES auth_role(key) ON DELETE CASCADE,
  FOREIGN KEY (scopeKey) REFERENCES auth_scope(key) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS auth_user_role (
  userId TEXT NOT NULL,
  roleKey TEXT NOT NULL,
  PRIMARY KEY (userId, roleKey),
  FOREIGN KEY (userId) REFERENCES auth_user(id) ON DELETE CASCADE,
  FOREIGN KEY (roleKey) REFERENCES auth_role(key) ON DELETE CASCADE
);

-- Team chat (Discord-style channels + messages)
CREATE TABLE IF NOT EXISTS chat_channel (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT,
  type TEXT NOT NULL DEFAULT 'channel',
  createdBy TEXT NOT NULL,
  createdAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS chat_message (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channelId TEXT NOT NULL,
  senderId TEXT NOT NULL,
  body TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  editedAt TEXT,
  deletedAt TEXT,
  attachments TEXT,
  replyToId INTEGER,
  FOREIGN KEY (channelId) REFERENCES chat_channel(id) ON DELETE CASCADE,
  FOREIGN KEY (senderId) REFERENCES auth_user(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_chat_message_channel ON chat_message(channelId, id);
CREATE TABLE IF NOT EXISTS chat_read_state (
  userId TEXT NOT NULL,
  channelId TEXT NOT NULL,
  lastReadId INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (userId, channelId),
  FOREIGN KEY (userId) REFERENCES auth_user(id) ON DELETE CASCADE,
  FOREIGN KEY (channelId) REFERENCES chat_channel(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS Enquiry (
  id TEXT PRIMARY KEY,
  estNumber TEXT NOT NULL DEFAULT '',
  clientCompany TEXT NOT NULL,
  contactName TEXT NOT NULL,
  contactEmail TEXT NOT NULL,
  contactPhone TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'medium',
  status TEXT NOT NULL DEFAULT 'new',
  assignedAgentId TEXT NOT NULL DEFAULT '',
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  imageUrls TEXT,
  activities TEXT,
  additionalRequirements TEXT
);
CREATE INDEX IF NOT EXISTS idx_enquiry_status ON Enquiry(status);
CREATE INDEX IF NOT EXISTS idx_enquiry_created ON Enquiry(createdAt);
CREATE TABLE IF NOT EXISTS EnquiryComment (
  id TEXT PRIMARY KEY,
  enquiryId TEXT NOT NULL,
  agentId INTEGER NOT NULL DEFAULT 0,
  content TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  parentId TEXT,
  imageUrl TEXT,
  FOREIGN KEY (enquiryId) REFERENCES Enquiry(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_enquiry_comment ON EnquiryComment(enquiryId, createdAt);
CREATE TABLE IF NOT EXISTS chat_member (
  channelId TEXT NOT NULL,
  userId TEXT NOT NULL,
  PRIMARY KEY (channelId, userId),
  FOREIGN KEY (channelId) REFERENCES chat_channel(id) ON DELETE CASCADE,
  FOREIGN KEY (userId) REFERENCES auth_user(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_chat_member_user ON chat_member(userId);

-- waba-worker merged: raw webhook payloads (waengine.pro ingress)
CREATE TABLE IF NOT EXISTS waba_payloads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  whatsapp_id TEXT NOT NULL UNIQUE,
  payload TEXT NOT NULL,
  direction TEXT DEFAULT 'inbound',
  processed INTEGER DEFAULT 0,
  ai_result TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  processed_at DATETIME
);
CREATE INDEX IF NOT EXISTS idx_waba_payloads_processed ON waba_payloads (processed, id);
CREATE INDEX IF NOT EXISTS idx_waba_payloads_direction ON waba_payloads (direction);

-- ── WhatsApp Business Autopilot (shadow mode) ───────────────────────────────
-- Core loop runs on the GH Actions runner; these tables are its source of truth.
CREATE TABLE IF NOT EXISTS WaTask (
  id TEXT PRIMARY KEY,
  chatId TEXT NOT NULL,
  chatName TEXT NOT NULL,
  taskType TEXT NOT NULL DEFAULT 'general',
  item TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','waiting','needs_clarification','needs_review','completed','cancelled')),
  priority TEXT,
  assignedTo TEXT,
  rootMessageId TEXT,
  summary TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  lastInboundAt TEXT,
  lastOutboundAt TEXT,
  waitingSince TEXT,
  waitTimeoutAt TEXT,
  followUpDueAt TEXT,
  followUpCount INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_watask_chat_status ON WaTask(chatId, status);
CREATE INDEX IF NOT EXISTS idx_watask_status ON WaTask(status);
CREATE INDEX IF NOT EXISTS idx_watask_followUpDueAt ON WaTask(followUpDueAt);
CREATE INDEX IF NOT EXISTS idx_watask_waitTimeoutAt ON WaTask(waitTimeoutAt);
CREATE INDEX IF NOT EXISTS idx_watask_createdAt ON WaTask(createdAt);

CREATE TABLE IF NOT EXISTS MessageLineage (
  id TEXT PRIMARY KEY,
  waMessageId TEXT NOT NULL UNIQUE,
  parentWaMessageId TEXT,
  rootWaMessageId TEXT,
  taskId TEXT,
  associationMethod TEXT NOT NULL DEFAULT 'llm',
  confidence REAL,
  resolutionStatus TEXT NOT NULL DEFAULT 'resolved',
  createdAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_lineage_task ON MessageLineage(taskId);
CREATE INDEX IF NOT EXISTS idx_lineage_root ON MessageLineage(rootWaMessageId);

CREATE TABLE IF NOT EXISTS WaTaskHistory (
  id TEXT PRIMARY KEY,
  taskId TEXT NOT NULL,
  transition TEXT NOT NULL,
  triggeredBy TEXT NOT NULL DEFAULT 'llm',
  messageId TEXT,
  notes TEXT,
  confidence REAL,
  occurredAt TEXT NOT NULL,
  FOREIGN KEY (taskId) REFERENCES WaTask(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_wathistory_task ON WaTaskHistory(taskId, occurredAt);

CREATE TABLE IF NOT EXISTS WaAction (
  id TEXT PRIMARY KEY,
  taskId TEXT,
  toolName TEXT NOT NULL,
  inputJson TEXT,
  outputJson TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  requestedBy TEXT NOT NULL DEFAULT 'llm',
  reason TEXT,
  error TEXT,
  createdAt TEXT NOT NULL,
  executedAt TEXT,
  FOREIGN KEY (taskId) REFERENCES WaTask(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_waaction_task ON WaAction(taskId);
CREATE INDEX IF NOT EXISTS idx_waaction_status ON WaAction(status, createdAt);

CREATE TABLE IF NOT EXISTS OverrideLog (
  id TEXT PRIMARY KEY,
  taskId TEXT,
  messageId TEXT,
  decisionType TEXT NOT NULL,
  systemDecision TEXT,
  systemConfidence REAL,
  humanDecision TEXT NOT NULL,
  reviewer TEXT,
  overriddenAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_overridelog_task ON OverrideLog(taskId);
CREATE INDEX IF NOT EXISTS idx_overridelog_type ON OverrideLog(decisionType);

-- ── Telecaller roster + Estimate assignment + Token storage ────────────────
CREATE TABLE IF NOT EXISTS Telecaller (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  "order" INTEGER NOT NULL DEFAULT 0,
  neodoveUserId TEXT,
  neodoveUserName TEXT,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS EstimateAssignment (
  id TEXT PRIMARY KEY,
  estimateId TEXT NOT NULL,
  telecallerId TEXT NOT NULL,
  assignedAt TEXT NOT NULL,
  day TEXT NOT NULL,
  reassignedFromId TEXT,
  status TEXT NOT NULL DEFAULT 'assigned',
  FOREIGN KEY (estimateId) REFERENCES Estimate(estimateId) ON DELETE CASCADE,
  FOREIGN KEY (telecallerId) REFERENCES Telecaller(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_estassign_estimate ON EstimateAssignment(estimateId);
CREATE INDEX IF NOT EXISTS idx_estassign_telecaller ON EstimateAssignment(telecallerId);
CREATE INDEX IF NOT EXISTS idx_estassign_day ON EstimateAssignment(day);

CREATE TABLE IF NOT EXISTS Token (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL UNIQUE,
  token TEXT NOT NULL,
  metadata TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_token_source ON Token(source);

-- ── Telecaller / estimate assignment (synced from Prisma; missing from initial D1 schema) ──
CREATE TABLE IF NOT EXISTS Telecaller (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  "order" INTEGER NOT NULL DEFAULT 0,
  neodoveUserId TEXT,
  neodoveUserName TEXT,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS EstimateAssignment (
  id TEXT PRIMARY KEY,
  estimateId TEXT NOT NULL,
  telecallerId TEXT NOT NULL,
  assignedAt TEXT NOT NULL,
  day TEXT NOT NULL,
  reassignedFromId TEXT,
  status TEXT NOT NULL DEFAULT 'assigned',
  FOREIGN KEY (estimateId) REFERENCES Estimate(estimateId) ON DELETE CASCADE,
  FOREIGN KEY (telecallerId) REFERENCES Telecaller(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_estassign_estimate ON EstimateAssignment(estimateId);
CREATE INDEX IF NOT EXISTS idx_estassign_telecaller ON EstimateAssignment(telecallerId);
CREATE INDEX IF NOT EXISTS idx_estassign_day ON EstimateAssignment(day);

-- ── Token storage (external auth tokens for NeoDove, Zoho, etc.) ──────────
CREATE TABLE IF NOT EXISTS Token (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL UNIQUE,
  token TEXT NOT NULL,
  metadata TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_token_source ON Token(source);