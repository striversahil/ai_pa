-- Sales agent contact details: phone + WhatsApp, used to reach the agent and
-- map incentives/payouts (linked to signed-up users via email).
ALTER TABLE Telecaller ADD COLUMN phone TEXT;
ALTER TABLE Telecaller ADD COLUMN whatsapp TEXT;