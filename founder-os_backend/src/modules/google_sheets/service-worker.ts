import { config } from '../../config';
import { logger } from '../../shared/logger';

function base64url(input: string | Uint8Array): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlDecode(input: string): Uint8Array {
  const b64 = input.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
  const bin = atob(b64 + pad);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function stripPemHeader(pem: string): string {
  return pem
    .replace(/-----BEGIN [A-Z ]+-----/, '')
    .replace(/-----END [A-Z ]+-----/, '')
    .replace(/\s+/g, '');
}

export class GoogleSheetsService {
  private static getCredentials(): any {
    if (config.GOOGLE_SERVICE_ACCOUNT_JSON) {
      try {
        return JSON.parse(config.GOOGLE_SERVICE_ACCOUNT_JSON);
      } catch (err) {
        logger.error('Failed to parse GOOGLE_SERVICE_ACCOUNT_JSON environment variable');
      }
    }
    return null;
  }

  /**
   * RS256 assertion JWT via WebCrypto (no node crypto / Buffer).
   */
  private static async signJWT(clientEmail: string, privateKey: string): Promise<string> {
    const header = { alg: 'RS256', typ: 'JWT' };
    const now = Math.floor(Date.now() / 1000);
    const claim = {
      iss: clientEmail,
      scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
      aud: 'https://oauth2.googleapis.com/token',
      exp: now + 3600,
      iat: now,
    };

    const base64Header = base64url(JSON.stringify(header));
    const base64Claim = base64url(JSON.stringify(claim));
    const signatureInput = `${base64Header}.${base64Claim}`;

    const pem = stripPemHeader(privateKey);
    const derBytes = base64urlDecode(pem.startsWith('MII') ? pem : pem);
    const der = derBytes.buffer.slice(derBytes.byteOffset, derBytes.byteOffset + derBytes.byteLength) as ArrayBuffer;
    const key = await crypto.subtle.importKey(
      'pkcs8',
      der,
      { name: 'RSASSA-PKCS1-v1_5', hash: { name: 'SHA-256' } },
      false,
      ['sign'],
    );

    const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(signatureInput));
    return `${signatureInput}.${base64url(new Uint8Array(sig))}`;
  }

  private static async getAccessToken(clientEmail: string, privateKey: string): Promise<string> {
    const jwt = await this.signJWT(clientEmail, privateKey);
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
    });
    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Google OAuth token retrieval failed: ${response.status} ${errText}`);
    }
    const data = (await response.json()) as any;
    return data.access_token;
  }

  public static extractSpreadsheetId(input: string): string {
    const trimmed = String(input ?? '').trim();
    const urlMatch = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (urlMatch) return urlMatch[1];
    if (/^[a-zA-Z0-9-_]{25,}$/.test(trimmed)) return trimmed;
    const looseMatch = trimmed.match(/([a-zA-Z0-9-_]{25,})/);
    if (looseMatch) return looseMatch[1];
    return trimmed;
  }

  public static async getSpreadsheetData(spreadsheetId: string, range: string) {
    const credentials = this.getCredentials();
    if (!credentials || !credentials.client_email || !credentials.private_key) {
      return {
        configured: false,
        error: 'Google Service Account credentials are not configured.',
        clientEmail: 'No service account email found',
        headers: [],
        rows: [],
      };
    }

    const resolvedId = this.extractSpreadsheetId(spreadsheetId);

    try {
      const accessToken = await this.getAccessToken(credentials.client_email, credentials.private_key);
      const encodedRange = encodeURIComponent(range);
      const sheetUrl = `https://sheets.googleapis.com/v4/spreadsheets/${resolvedId}/values/${encodedRange}`;
      const response = await fetch(sheetUrl, {
        headers: { 'Authorization': `Bearer ${accessToken}`, 'Accept': 'application/json' },
      });
      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Sheets API responded with error: ${response.status} ${errText}`);
      }
      const responseData = (await response.json()) as any;
      const values = responseData.values;
      if (!values || values.length === 0) {
        return { configured: true, clientEmail: credentials.client_email, headers: [], rows: [] };
      }
      const headers = values[0];
      const rows = values.slice(1).map((row: any[], idx: number) => {
        const rowData: Record<string, string> = { _rowId: String(idx + 1) };
        headers.forEach((header: string, index: number) => {
          rowData[header] = row[index] !== undefined ? String(row[index]) : '';
        });
        return rowData;
      });
      return { configured: true, clientEmail: credentials.client_email, headers, rows };
    } catch (err: any) {
      logger.error({ error: err.message }, 'Failed to fetch Google Sheet data');
      return {
        configured: true,
        error: `Failed to fetch Google Sheet: ${err.message}`,
        clientEmail: credentials.client_email,
        headers: [],
        rows: [],
      };
    }
  }
}