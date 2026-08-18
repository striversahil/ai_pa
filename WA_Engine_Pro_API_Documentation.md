# WA Engine Pro API Documentation

**Base URL:** `https://waengine.pro/api/v1`  
**API Version:** v1  
**Documentation Snapshot:** 17 August 2026, 15:00

> **Security:** The API key supplied in the source material has been intentionally redacted from this documentation. Never commit a live API key to source control, client-side code, logs, or public documentation.

---

## 1. Authentication

All API requests require the following header:

```http
X-API-Key: YOUR_API_KEY
```

### Verify API Key

**GET** `/me`

Returns workspace information and verifies the API key.

```bash
curl https://waengine.pro/api/v1/me \
  -H "X-API-Key: YOUR_API_KEY"
```

---

## 2. API Conventions

### Response Format

Successful responses:

```json
{
  "success": true,
  "data": {}
}
```

Error responses:

```json
{
  "success": false,
  "message": "Error description"
}
```

### HTTP Status Codes

| Status | Meaning |
|---|---|
| `200` | Successful request |
| `400` | Invalid input |
| `401` | Authentication failure |
| `404` | Resource not found |

### Phone Number Format

Phone numbers must include the country code and **must not include `+`**.

Example:

```text
919876543210
```

### API Key Rotation

If an API key is exposed, regenerate it immediately. The old key stops working immediately after regeneration.

---

# 3. Messaging

## 3.1 Send Text Message

**POST** `/messages/send`

Send a free-form text message to a customer.

**Important:** Free-form messages can only be sent within the WhatsApp 24-hour customer-service window, i.e. after the customer has messaged you within the previous 24 hours.

For a new number, the contact and conversation are created automatically.

### Request

```json
{
  "phone": "919876543210",
  "message": "Hello from API!"
}
```

### cURL

```bash
curl -X POST https://waengine.pro/api/v1/messages/send \
  -H "X-API-Key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "919876543210",
    "message": "Hello from API!"
  }'
```

---

## 3.2 Send Template Message

**POST** `/messages/template`

Send an approved WhatsApp template. Template messages can be sent outside the 24-hour customer-service window.

### Request

`variables` contains values for body placeholders such as `{{1}}`, `{{2}}`, in order.

```json
{
  "phone": "919876543210",
  "template_name": "hello_world",
  "language": "en_US",
  "variables": ["Raj"]
}
```

### cURL

```bash
curl -X POST https://waengine.pro/api/v1/messages/template \
  -H "X-API-Key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "919876543210",
    "template_name": "hello_world",
    "language": "en_US",
    "variables": ["Raj"]
  }'
```

### Optional Template Variables

- `header_variables` — values for header placeholders such as `{{1}}`.
- `button_variables` — dynamic button values.

Button object:

```json
{
  "index": 0,
  "sub_type": "url",
  "text": "ORDER123"
}
```

Supported `sub_type` values:

- `url`
- `quick_reply`
- `copy_code`

`index` is the button position, where `0` is the first button.

### Dynamic Button Example

```bash
curl -X POST https://waengine.pro/api/v1/messages/template \
  -H "X-API-Key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "919876543210",
    "template_name": "order_update",
    "language": "en_US",
    "variables": ["Raj"],
    "button_variables": [
      {
        "index": 0,
        "sub_type": "url",
        "text": "ORDER123"
      }
    ]
  }'
```

---

## 3.3 Send Media

**POST** `/messages/media`

Send an image, video, document, or audio file from a **public URL**.

Supported `media_type` values:

- `image`
- `video`
- `document`
- `audio`

`caption` is optional.

### Request

```json
{
  "phone": "919876543210",
  "media_type": "image",
  "url": "https://example.com/offer.jpg",
  "caption": "Diwali Offer!"
}
```

### cURL

```bash
curl -X POST https://waengine.pro/api/v1/messages/media \
  -H "X-API-Key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "919876543210",
    "media_type": "image",
    "url": "https://example.com/offer.jpg",
    "caption": "Diwali Offer!"
  }'
```

---

## 3.4 Interactive Buttons

**POST** `/messages/interactive/buttons`

Send interactive reply buttons.

**Requirements:**

- Must be sent inside an open 24-hour session.
- Maximum 3 buttons.
- `body` is required.
- `header` and `footer` are optional.
- Buttons may be strings or objects containing `id` and `title`.

When the customer taps a button, the resulting inbound message contains the button title/id.

### Request

```json
{
  "phone": "919876543210",
  "body": "Confirm your booking?",
  "buttons": [
    "Yes",
    "No",
    "Talk to agent"
  ],
  "footer": "Fenex Tours"
}
```

---

## 3.5 Interactive List

**POST** `/messages/interactive/list`

Send an interactive list/menu message.

**Requirements:**

- Must be sent inside an open 24-hour session.
- `body` is required.
- `sections[]` is required.
- Each section contains `title` and `rows[]`.
- Each row contains `id`, `title`, and optional `description`.
- Row title maximum: 24 characters.
- Row description maximum: 72 characters.
- `button` defaults to `Menu`.
- `header` and `footer` are optional.

### Request

```json
{
  "phone": "919876543210",
  "body": "Please choose a category",
  "button": "View menu",
  "sections": [
    {
      "title": "Tours",
      "rows": [
        {
          "id": "tour_enquiry",
          "title": "Tour Enquiry",
          "description": "Plan a new trip"
        },
        {
          "id": "corporate",
          "title": "Corporate Tours"
        }
      ]
    }
  ]
}
```

---

## 3.6 Get Conversation Messages

**GET** `/messages`

Returns messages for a conversation from oldest to newest.

### Query Parameters

| Parameter | Required | Description |
|---|---|---|
| `conversation_id` | Yes | Conversation ID |
| `limit` | No | Number of messages; maximum 200 |

### Example

```bash
curl "https://waengine.pro/api/v1/messages?conversation_id=CONVERSATION_ID&limit=50" \
  -H "X-API-Key: YOUR_API_KEY"
```

---

# 4. Contacts

## 4.1 List Contacts

**GET** `/contacts`

List contacts with optional search and pagination.

### Query Parameters

| Parameter | Required | Description |
|---|---|---|
| `search` | No | Search by name, phone, or email |
| `page` | No | Page number |
| `limit` | No | Results per page |

Contact records may include lead score, birthday, and custom fields.

### Example

```bash
curl "https://waengine.pro/api/v1/contacts?search=raj&page=1&limit=50" \
  -H "X-API-Key: YOUR_API_KEY"
```

---

## 4.2 Get Contact

**GET** `/contacts/:id`

Returns full contact details, including tags, custom fields, lead score, and more.

```bash
curl https://waengine.pro/api/v1/contacts/CONTACT_ID \
  -H "X-API-Key: YOUR_API_KEY"
```

---

## 4.3 Create Contact

**POST** `/contacts`

Creates a contact. If the phone already exists, the existing contact's name/email are updated.

### Request

```json
{
  "name": "Raj Kumar",
  "phone": "919876543210",
  "email": "raj@example.com"
}
```

### cURL

```bash
curl -X POST https://waengine.pro/api/v1/contacts \
  -H "X-API-Key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Raj Kumar",
    "phone": "919876543210",
    "email": "raj@example.com"
  }'
```

---

## 4.4 Update Contact

**PUT** `/contacts/:id`

Update name, email, and/or custom fields.

```json
{
  "name": "Raj Kumar",
  "email": "raj@example.com",
  "custom_fields": {
    "city": "Jaipur"
  }
}
```

---

## 4.5 Delete Contact

**DELETE** `/contacts/:id`

Permanently deletes a contact.

```bash
curl -X DELETE https://waengine.pro/api/v1/contacts/CONTACT_ID \
  -H "X-API-Key: YOUR_API_KEY"
```

---

## 4.6 Add Contact Tags

**POST** `/contacts/:id/tags`

Adds tags by name. Tags are created automatically if they do not already exist.

### Request

```json
{
  "tags": [
    "vip",
    "lead"
  ]
}
```

---

# 5. Tags & Segments

## 5.1 List Tags

**GET** `/tags`

Returns all workspace tags with name and color.

```bash
curl https://waengine.pro/api/v1/tags \
  -H "X-API-Key: YOUR_API_KEY"
```

## 5.2 List Segments

**GET** `/segments`

Returns contact segments with name, description, and contact count.

```bash
curl https://waengine.pro/api/v1/segments \
  -H "X-API-Key: YOUR_API_KEY"
```

---

# 6. Conversations

## 6.1 List Conversations

**GET** `/conversations`

Returns recent conversations with contact details, status, last message, unread count, and sentiment.

`limit` is optional; maximum is 100.

```bash
curl "https://waengine.pro/api/v1/conversations?limit=50" \
  -H "X-API-Key: YOUR_API_KEY"
```

## 6.2 Assign Conversation

**POST** `/conversations/:id/assign`

Assign a conversation to an agent by email.

```json
{
  "agent_email": "agent@example.com"
}
```

## 6.3 Close Conversation

**POST** `/conversations/:id/close`

Marks a conversation as resolved/closed.

```bash
curl -X POST https://waengine.pro/api/v1/conversations/CONVERSATION_ID/close \
  -H "X-API-Key: YOUR_API_KEY"
```

---

# 7. Broadcasts

## 7.1 List Broadcasts

**GET** `/broadcasts`

Returns broadcasts with status and delivery statistics including sent, delivered, read, and failed.

```bash
curl https://waengine.pro/api/v1/broadcasts \
  -H "X-API-Key: YOUR_API_KEY"
```

## 7.2 Create & Start Broadcast

**POST** `/broadcasts`

Creates and starts a template broadcast to a list of phone numbers.

### Required

- `name`
- `template_name`
- `phones[]`

`language` is optional and defaults to `en`.

### Request

```json
{
  "name": "Diwali Offer",
  "template_name": "diwali_offer",
  "language": "en",
  "phones": [
    "919876543210",
    "919876543211"
  ]
}
```

## 7.3 Get Broadcast

**GET** `/broadcasts/:id`

Returns details and live statistics for one broadcast.

```bash
curl https://waengine.pro/api/v1/broadcasts/BROADCAST_ID \
  -H "X-API-Key: YOUR_API_KEY"
```

---

# 8. Orders

## 8.1 List Orders

**GET** `/orders`

Lists orders with contact name and phone.

### Query Parameters

| Parameter | Required | Description |
|---|---|---|
| `status` | No | Filter by order status |

### Example

```bash
curl "https://waengine.pro/api/v1/orders?status=pending" \
  -H "X-API-Key: YOUR_API_KEY"
```

---

# 9. Templates

## 9.1 List Templates

**GET** `/templates`

Lists WhatsApp templates, including carousel cards.

### Status Filter

Supported values:

- `approved`
- `pending`
- `rejected`

```bash
curl "https://waengine.pro/api/v1/templates?status=approved" \
  -H "X-API-Key: YOUR_API_KEY"
```

---

# 10. Appointments

## 10.1 List Appointments

**GET** `/appointments`

### Query Parameters

| Parameter | Required | Description |
|---|---|---|
| `status` | No | `scheduled`, `confirmed`, `completed`, `cancelled` |
| `from` | No | Start date, `YYYY-MM-DD` |
| `to` | No | End date, `YYYY-MM-DD` |

### Example

```bash
curl "https://waengine.pro/api/v1/appointments?from=2026-06-01&to=2026-06-30&status=scheduled" \
  -H "X-API-Key: YOUR_API_KEY"
```

## 10.2 Create Appointment

**POST** `/appointments`

Creates an appointment.

### Required

- `title`
- `date` (`YYYY-MM-DD`)
- `start_time` (`HH:MM`)

### Optional

- `phone` — links or creates a contact
- `name`
- `duration` — minutes; default 30
- `notes`

### Request

```json
{
  "phone": "919876543210",
  "name": "Raj",
  "title": "Demo Call",
  "date": "2026-07-01",
  "start_time": "15:00",
  "duration": 30,
  "notes": "Website se aaya lead"
}
```

---

# 11. Support Tickets

## 11.1 List Tickets

**GET** `/tickets`

Lists support tickets with contact name and phone.

Optional `status`:

- `open`
- `closed`

```bash
curl "https://waengine.pro/api/v1/tickets?status=open" \
  -H "X-API-Key: YOUR_API_KEY"
```

## 11.2 Update Ticket

**PATCH** `/tickets/:id`

Close or reopen a ticket.

### Request

```json
{
  "status": "closed"
}
```

Supported values:

- `open`
- `closed`

---

# 12. Payment Links

## 12.1 List Payment Links

**GET** `/payment-links`

Lists payment links and their status.

Supported statuses:

- `created`
- `paid`
- `cancelled`

Optional parameters:

- `status`
- `limit` — maximum 200

### Example

```bash
curl "https://waengine.pro/api/v1/payment-links?status=paid&limit=50" \
  -H "X-API-Key: YOUR_API_KEY"
```

## 12.2 Create Payment Link

**POST** `/payment-links`

Creates a payment link and, by default, sends it to the customer through WhatsApp.

### Payment Methods

- `razorpay` — default
- `upi`
- `stripe`
- `cashfree`
- `paypal`
- `paystack`
- `phonepe`
- `paytm`

The selected gateway must be connected on the Integrations page.

For `method=upi`, provide `upi_id`.

Use `send=false` to create the payment link without sending it.

### Request

```json
{
  "phone": "919876543210",
  "amount": 499,
  "method": "razorpay",
  "description": "Order #1234"
}
```

---

# 13. Wallet

## 13.1 Get Wallet Balance

**GET** `/wallet`

Returns the current workspace wallet balance.

```bash
curl https://waengine.pro/api/v1/wallet \
  -H "X-API-Key: YOUR_API_KEY"
```

## 13.2 Get Wallet Transactions

**GET** `/wallet/transactions`

Returns recent wallet ledger entries, including credits/top-ups and debits/message costs.

`limit` is optional; maximum 200.

```bash
curl "https://waengine.pro/api/v1/wallet/transactions?limit=50" \
  -H "X-API-Key: YOUR_API_KEY"
```

---

# 14. CRM / Pipeline

## 14.1 List Pipelines

**GET** `/pipelines`

Lists CRM pipelines, stages, and deal counts.

Use a stage ID when creating or moving deals.

```bash
curl https://waengine.pro/api/v1/pipelines \
  -H "X-API-Key: YOUR_API_KEY"
```

## 14.2 List Deals

**GET** `/deals`

Lists deals across all pipelines.

### Query Parameters

| Parameter | Required | Description |
|---|---|---|
| `status` | No | `open`, `won`, `lost` |
| `stage` | No | Stage ID |
| `limit` | No | Maximum 300 |

### Example

```bash
curl "https://waengine.pro/api/v1/deals?status=open&limit=100" \
  -H "X-API-Key: YOUR_API_KEY"
```

## 14.3 Create Deal

**POST** `/deals`

Creates a deal.

### Required

- `title`

### Optional

- `value`
- `notes`
- `phone`
- `pipeline_id`
- `stage`

If `pipeline_id` and `stage` are omitted, the first pipeline and first stage are used.

### Request

```json
{
  "title": "Enterprise deal",
  "value": 50000,
  "phone": "919876543210",
  "notes": "Referred by partner"
}
```

## 14.4 Update Deal

**PATCH** `/deals/:id`

Move a deal to another stage or update its status/value/notes.

Supported `status`:

- `open`
- `won`
- `lost`

### Request

```json
{
  "stage": "won",
  "status": "won"
}
```

Supported fields:

- `stage`
- `status`
- `value`
- `notes`

---

# 15. Bot Flows

## 15.1 List Bot Flows

**GET** `/bot-flows`

Returns bot flows with active status and run count.

```bash
curl https://waengine.pro/api/v1/bot-flows \
  -H "X-API-Key: YOUR_API_KEY"
```

## 15.2 Toggle Bot Flow

**POST** `/bot-flows/:id/toggle`

Turn a bot flow ON or OFF.

`active` defaults to `true`.

### Request

```json
{
  "active": true
}
```

---

# 16. Quick Replies

## 16.1 List Quick Replies

**GET** `/quick-replies`

Returns saved quick replies with:

- title
- message
- shortcut

```bash
curl https://waengine.pro/api/v1/quick-replies \
  -H "X-API-Key: YOUR_API_KEY"
```

---

# 17. Agents

## 17.1 List Agents

**GET** `/agents`

Lists workspace agents with:

- name
- email
- role

```bash
curl https://waengine.pro/api/v1/agents \
  -H "X-API-Key: YOUR_API_KEY"
```

## 17.2 Agent Performance

**GET** `/agents/performance`

Returns per-agent performance metrics:

- assigned chats
- resolved chats over the last 30 days
- messages sent over the last 30 days

```bash
curl https://waengine.pro/api/v1/agents/performance \
  -H "X-API-Key: YOUR_API_KEY"
```

---

# 18. Webhooks

Webhooks allow WA Engine Pro to send event notifications to your server through HTTP POST requests.

## 18.1 List Webhooks

**GET** `/webhooks`

Returns registered webhook subscriptions.

```bash
curl https://waengine.pro/api/v1/webhooks \
  -H "X-API-Key: YOUR_API_KEY"
```

## 18.2 Register Webhook

**POST** `/webhooks`

Register a webhook URL.

### Supported Events

- `message.received`
- `message.status`
- `contact.created`

The configured URL receives a JSON `POST` whenever a subscribed event occurs.

### Request

```json
{
  "url": "https://example.com/my-webhook",
  "events": [
    "message.received",
    "message.status"
  ]
}
```

### cURL

```bash
curl -X POST https://waengine.pro/api/v1/webhooks \
  -H "X-API-Key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com/my-webhook",
    "events": [
      "message.received",
      "message.status"
    ]
  }'
```

## 18.3 Delete Webhook

**DELETE** `/webhooks/:id`

Removes a webhook subscription.

```bash
curl -X DELETE https://waengine.pro/api/v1/webhooks/WEBHOOK_ID \
  -H "X-API-Key: YOUR_API_KEY"
```

---

# 19. Endpoint Reference

| Module | Method | Endpoint | Purpose |
|---|---|---|---|
| Authentication | GET | `/me` | Verify API key / workspace |
| Messaging | POST | `/messages/send` | Send text |
| Messaging | POST | `/messages/template` | Send approved template |
| Messaging | POST | `/messages/media` | Send media |
| Messaging | POST | `/messages/interactive/buttons` | Send reply buttons |
| Messaging | POST | `/messages/interactive/list` | Send interactive list |
| Messaging | GET | `/messages` | Get conversation messages |
| Contacts | GET | `/contacts` | List contacts |
| Contacts | GET | `/contacts/:id` | Get contact |
| Contacts | POST | `/contacts` | Create contact |
| Contacts | PUT | `/contacts/:id` | Update contact |
| Contacts | DELETE | `/contacts/:id` | Delete contact |
| Contacts | POST | `/contacts/:id/tags` | Add tags |
| Tags | GET | `/tags` | List tags |
| Segments | GET | `/segments` | List segments |
| Conversations | GET | `/conversations` | List conversations |
| Conversations | POST | `/conversations/:id/assign` | Assign conversation |
| Conversations | POST | `/conversations/:id/close` | Close conversation |
| Broadcasts | GET | `/broadcasts` | List broadcasts |
| Broadcasts | POST | `/broadcasts` | Create/start broadcast |
| Broadcasts | GET | `/broadcasts/:id` | Get broadcast |
| Orders | GET | `/orders` | List orders |
| Templates | GET | `/templates` | List templates |
| Appointments | GET | `/appointments` | List appointments |
| Appointments | POST | `/appointments` | Create appointment |
| Tickets | GET | `/tickets` | List tickets |
| Tickets | PATCH | `/tickets/:id` | Update ticket |
| Payments | GET | `/payment-links` | List payment links |
| Payments | POST | `/payment-links` | Create payment link |
| Wallet | GET | `/wallet` | Get balance |
| Wallet | GET | `/wallet/transactions` | Get ledger |
| CRM | GET | `/pipelines` | List pipelines |
| CRM | GET | `/deals` | List deals |
| CRM | POST | `/deals` | Create deal |
| CRM | PATCH | `/deals/:id` | Update deal |
| Bot Flows | GET | `/bot-flows` | List flows |
| Bot Flows | POST | `/bot-flows/:id/toggle` | Toggle flow |
| Quick Replies | GET | `/quick-replies` | List quick replies |
| Agents | GET | `/agents` | List agents |
| Agents | GET | `/agents/performance` | Agent performance |
| Webhooks | GET | `/webhooks` | List webhooks |
| Webhooks | POST | `/webhooks` | Register webhook |
| Webhooks | DELETE | `/webhooks/:id` | Delete webhook |

---

# 20. Integration Notes

## 20.1 24-Hour WhatsApp Window

Use free-form messaging, media, buttons, and lists only when the customer-service window is open.

For outbound communication outside the 24-hour window, use an approved WhatsApp template.

## 20.2 Recommended Integration Flow

A typical CRM/automation integration can follow this pattern:

1. Receive `message.received` through a webhook.
2. Identify the contact using the incoming phone number.
3. Retrieve or create the contact.
4. Retrieve the conversation/messages when required.
5. Process the inbound enquiry in your CRM or automation layer.
6. Send a free-form response if the 24-hour window is open.
7. Otherwise send an approved template.
8. Update the CRM deal/pipeline where required.
9. Use `message.status` webhooks to track message delivery status.

## 20.3 Webhook Events

Recommended event handling:

| Event | Typical Use |
|---|---|
| `message.received` | Trigger automation on inbound WhatsApp messages |
| `message.status` | Track message delivery/status changes |
| `contact.created` | Sync newly created contacts into CRM |

---

# 21. Security Checklist

- [ ] Store the API key in environment variables or a secrets manager.
- [ ] Never expose the API key in browser/frontend JavaScript.
- [ ] Never commit the API key to Git.
- [ ] Never paste the API key into public documentation.
- [ ] Use HTTPS for all webhook endpoints.
- [ ] Validate webhook requests before processing them.
- [ ] Rotate the API key immediately if it is exposed.
- [ ] Keep webhook processing idempotent to avoid duplicate automation.
- [ ] Log API errors without logging authentication secrets.

---

# 22. Quick Start

### Set Environment Variable

```bash
export WA_ENGINE_API_KEY="YOUR_API_KEY"
```

### Verify Authentication

```bash
curl https://waengine.pro/api/v1/me \
  -H "X-API-Key: $WA_ENGINE_API_KEY"
```

### Send a Text

```bash
curl -X POST https://waengine.pro/api/v1/messages/send \
  -H "X-API-Key: $WA_ENGINE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "919876543210",
    "message": "Hello from WA Engine Pro API!"
  }'
```

### Register a Webhook

```bash
curl -X POST https://waengine.pro/api/v1/webhooks \
  -H "X-API-Key: $WA_ENGINE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com/my-webhook",
    "events": [
      "message.received",
      "message.status"
    ]
  }'
```

---

## Documentation Source

This document was generated from the WA Engine Pro **API & Developers** documentation supplied by the user.

**Base URL:** `https://waengine.pro/api/v1`
