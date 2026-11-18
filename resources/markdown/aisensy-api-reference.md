# AiSensy WhatsApp Business REST API Reference for AI Agents

This document provides a comprehensive specification of the AiSensy REST API endpoints, schemas, authentication, and behavior models. It is designed to act as a system prompt context or tool execution reference for an autonomous AI developer agent.

---

## 1. Global Specifications & System Rules

### 1.1 Base URLs
* **Standard REST API:** `https://api.aisensy.io/v1`
* **Campaign Gateway Engine:** `https://backend.aisensy.com`

### 1.2 Global Headers
All outbound requests must transmit the following headers:
```http
Content-Type: application/json
```

### 1.3 Target Object Lifecycle Constraint
An AI agent **cannot** execute template deliveries using raw template identifiers alone. To emit an approved WhatsApp template, an **API Campaign** must first be initialized manually or programmatically inside the AiSensy UI. The case-sensitive string identifier `campaignName` maps your payload to that operational workspace context.

---

## 2. Authentication Context Matrix

AiSensy supports two alternative payload structures for authentication depending on the designated routing endpoint.

### 2.1 Route Type A: Bearer Authorization Header
Used across standard `/messages`, `/contacts`, and structural entity resources.
```http
Authorization: Bearer <YOUR_API_KEY>
```

### 2.2 Route Type B: Inline JSON Key
Used specifically by the campaign execution engine (`/campaign/t1/api/v2`).
```json
{
  "apiKey": "<YOUR_API_KEY>"
}
```

---

## 3. Core API Endpoint Manifest

### 3.1 Send Campaign Template (Bulk / Single Transaction)
* **Method:** `POST`
* **Endpoint:** `https://backend.aisensy.com/campaign/t1/api/v2`
* **Authentication:** Inline Payload Key (`apiKey`)

#### Payload Schema (JSON)
```json
{
  "apiKey": "string (Required)",
  "campaignName": "string (Required) - Case-sensitive active campaign name",
  "destination": "string (Required) - Receiver mobile number with '+' and country code",
  "userName": "string (Required) - Fallback display label for target contact",
  "source": "string (Optional) - Lead capture metadata attribution string",
  "media": {
    "url": "string (Required if template has media header) - Public URL asset link",
    "filename": "string (Required if template has media header) - Explicit file title"
  },
  "templateParams": [
    "string - Sequential template variable arrays mapped to {{1}}, {{2}}, etc."
  ],
  "tags": [
    "string - Array tags to append to the customer identity container"
  ],
  "attributes": {
    "custom_key_1": "string - Key-value structural mappings targeting custom fields"
  }
}
```

#### Side-Effects & Core Logic
* If the incoming `destination` string value does not match an existing contact sequence index inside the AiSensy workspace database, **a new contact entity is implicitly created** using the `userName` provided.
* If the target template does not require media headers, the `"media"` object key **must be entirely excluded** from the object tree to prevent strict parameter parsing faults.

---

### 3.2 Send Interactive/Free-Form Session Message
* **Method:** `POST`
* **Endpoint:** `https://api.aisensy.io/v1/messages`
* **Authentication:** Bearer Header Token

*Context: Only functional if an active 24-hour customer service window is open (triggered by a prior inbound user interaction).*

#### Text Schema
```json
{
  "to": "string (Required) - Target number with plus sign country prefix",
  "type": "text",
  "text": {
    "body": "string (Required) - Raw message text copy formatting string"
  }
}
```

#### Media Schema (Image/Document/Video)
```json
{
  "to": "string (Required)",
  "type": "image",
  "image": {
    "link": "string (Required) - Public downloadable media asset url",
    "caption": "string (Optional) - Supporting subtext content copy"
  }
}
```

#### Interactive Quick-Reply Buttons Schema
```json
{
  "to": "string (Required)",
  "type": "interactive",
  "interactive": {
    "type": "button",
    "header": { "type": "text", "text": "Header Title Copy" },
    "body": { "text": "Main contextual body instructions description" },
    "footer": { "text": "Supporting footer disclaimer text" },
    "action": {
      "buttons": [
        {
          "type": "reply",
          "reply": {
            "id": "btn_unique_id_01",
            "title": "Option One Text"
          }
        }
      ]
    }
  }
}
```

---

### 3.3 Contact State Syncing & Database Access
* **Method:** `POST`
* **Endpoint:** `https://api.aisensy.io/v1/contacts`
* **Authentication:** Bearer Header Token

#### Payload Schema
```json
{
  "contacts": [
    "string - Explicit mobile phone string numbers arrays"
  ]
}
```
#### Response Structure
Returns standard verification parameters showing whether the number has a functional, registered WhatsApp user registration identity context (`"status": "valid"`).

---

## 4. Webhook Telemetry & Event Schema Matrix

Configure downstream capture servers to swallow inbound JSON structural elements reflecting the communication loop state variables.

### 4.1 Message Status Outbound Delivery Tracking
Emitted dynamically when an outbound template change state resolves.
```json
{
  "event": "message_status",
  "id": "msg_identity_string_hash",
  "destination": "+919876543210",
  "status": "sent | delivered | read | failed",
  "timestamp": 1718223402,
  "failure_reason": "string (Optional) - System diagnostic failure description"
}
```

### 4.2 Inbound Inbound Chat Message Capture
Emitted when a customer pushes a text string payload into the WhatsApp chat sequence context.
```json
{
  "event": "inbound_message",
  "from": "+919876543210",
  "type": "text",
  "text": {
    "body": "User response message raw copy"
  },
  "timestamp": 1718223455
}
```

### 4.3 Inbound Interactive Button Selection Capture
Emitted when a client taps a quick reply button choice generated by session messages.
```json
{
  "event": "inbound_message",
  "from": "+919876543210",
  "type": "interactive",
  "interactive": {
    "type": "button_reply",
    "button_reply": {
      "id": "btn_unique_id_01",
      "title": "Option One Text"
    }
  },
  "timestamp": 1718223490
}
```

---

## 5. Agent Diagnostic Error Engine Codes

| Code HTTP | Machine Token / Message | Root Cause State | Resolution Steps Strategy |
| :--- | :--- | :--- | :--- |
| **`400`** | `Campaign Not Found` | The string passed to `campaignName` does not match an active API campaign. | Create/Resume campaign in UI workspace dashboard; check case structure matches exactly. |
| **`400`** | `Invalid Parameters` | The array sizing context in `templateParams` lacks length synchronization with placeholders. | Check matching bounds variables inside template registry config options. |
| **`401`** | `Invalid API Key` | The authentication secret header signature string token is expired or altered. | Revoke and rebuild API Key secret maps under Platform Configuration parameters. |
| **`429`** | `Rate Limit Exceeded` | Threshold capacity metrics cross platform resource traffic configurations. | Implement programmatic exponential backoff queues with randomized jitter steps. |
| **`500`** | `Internal Error` | Underlying upstream Meta Cloud API server cluster nodes report network timeout errors. | Intercept and cache items securely inside your messaging backlog for automatic retry schedules. |
