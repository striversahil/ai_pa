import { config } from '../config';
import { logger } from './logger';

export interface WaEngineConfig {
  vendorUid: string;
  bearerToken: string;
  apiBaseUrl: string;
}

export function getWaEngineConfig(req?: any): WaEngineConfig {
  const vendorUid = req?.headers?.['x-wa-vendor-uid'] || process.env.WA_ENGINE_VENDOR_UID || 'b35c07b9-99fa-4224-a7f3-1ea587cb2e64';
  const bearerToken = req?.headers?.['x-wa-bearer-token'] || process.env.WA_ENGINE_BEARER_TOKEN || 'aNxAArZ6ahSs81ogk4rZXgk1C8f7jJ66PtbkDOmlRVORWRMt0ZT9VJTA6Gmw2Ua8';
  const apiBaseUrl = 'https://plus.waengine.in/api';
  return { vendorUid, bearerToken, apiBaseUrl };
}

export async function resolveContactName(
  contactUid: string,
  vendorUid: string,
  bearerToken: string,
  apiBaseUrl: string
): Promise<string> {
  try {
    const groupsUrl = `${apiBaseUrl}/${vendorUid}/groups`;
    const groupsRes = await fetch(groupsUrl, {
      headers: { 'Authorization': `Bearer ${bearerToken}` }
    });
    if (groupsRes.ok) {
      const groupsData = await groupsRes.json() as any;
      const groups = groupsData.data || [];
      for (const group of groups) {
        const contactsUrl = `${apiBaseUrl}/${vendorUid}/groups/${group.uid}/contacts`;
        const contactsRes = await fetch(contactsUrl, {
          headers: { 'Authorization': `Bearer ${bearerToken}` }
        });
        if (contactsRes.ok) {
          const contactsData = await contactsRes.json() as any;
          const contacts = contactsData.data || [];
          const matched = contacts.find((c: any) => c.uid === contactUid || c.wa_id === contactUid || `${c.wa_id}@c.us` === contactUid);
          if (matched) {
            return (matched.full_name || matched.first_name || matched.wa_id || 'Client').trim();
          }
        }
      }
    }
  } catch (e) {}

  if (contactUid.includes('919811044521')) return 'Sanjay Singhal';
  if (contactUid.includes('918511299014')) return 'Vikram Rathore';
  if (contactUid.includes('918595563952')) return 'Sahil Kumar';
  return contactUid.split('@')[0];
}

export async function resolveContactUid(
  contactUid: string,
  vendorUid: string,
  bearerToken: string,
  apiBaseUrl: string
): Promise<string> {
  if (contactUid.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
    return contactUid;
  }
  const phoneNumber = contactUid.replace(/[^0-9]/g, '');
  if (!phoneNumber) return contactUid;
  try {
    const url = `${apiBaseUrl}/${vendorUid}/contact/by-phone?phone_number=${phoneNumber}`;
    const response = await fetch(url, {
      headers: { 'Authorization': `Bearer ${bearerToken}` }
    });
    if (response.ok) {
      const data = await response.json() as any;
      if (data.data?.contact_uid) return data.data.contact_uid;
    }
  } catch (e: any) {
    logger.warn({ error: e.message, phoneNumber }, 'Failed to resolve contact UID by phone number');
  }
  return contactUid;
}
