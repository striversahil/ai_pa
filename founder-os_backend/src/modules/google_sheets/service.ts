import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { config } from '../../config';
import { logger } from '../../shared/logger';

export class GoogleSheetsService {
  /**
   * Helper function to get service account credentials
   */
  private static getCredentials(): any {
    if (config.GOOGLE_SERVICE_ACCOUNT_JSON) {
      try {
        return JSON.parse(config.GOOGLE_SERVICE_ACCOUNT_JSON);
      } catch (err) {
        logger.error('Failed to parse GOOGLE_SERVICE_ACCOUNT_JSON environment variable');
      }
    }

    if (config.GOOGLE_SERVICE_ACCOUNT_PATH) {
      try {
        const fullPath = path.resolve(config.GOOGLE_SERVICE_ACCOUNT_PATH);
        if (fs.existsSync(fullPath)) {
          return JSON.parse(fs.readFileSync(fullPath, 'utf8'));
        }
      } catch (err) {
        logger.error('Failed to read GOOGLE_SERVICE_ACCOUNT_PATH file');
      }
    }

    // Look for default file in root
    const pathsToSearch = [
      path.join(process.cwd(), 'google-service-account.json'),
      path.join(process.cwd(), '../google-service-account.json'),
      path.join(__dirname, '../../../google-service-account.json'),
      path.join(__dirname, '../../../../google-service-account.json'),
    ];

    for (const defaultPath of pathsToSearch) {
      if (fs.existsSync(defaultPath)) {
        try {
          return JSON.parse(fs.readFileSync(defaultPath, 'utf8'));
        } catch (err) {
          logger.error({ path: defaultPath }, 'Failed to read google-service-account.json');
        }
      }
    }

    return null;
  }

  /**
   * Zero-dependency Google OAuth2 JWT assertion token signer
   */
  private static signJWT(clientEmail: string, privateKey: string): string {
    const header = {
      alg: 'RS256',
      typ: 'JWT'
    };
    const now = Math.floor(Date.now() / 1000);
    const claim = {
      iss: clientEmail,
      scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
      aud: 'https://oauth2.googleapis.com/token',
      exp: now + 3600,
      iat: now
    };

    const base64Header = Buffer.from(JSON.stringify(header)).toString('base64url');
    const base64Claim = Buffer.from(JSON.stringify(claim)).toString('base64url');
    const signatureInput = `${base64Header}.${base64Claim}`;

    const sign = crypto.createSign('RSA-SHA256');
    sign.update(signatureInput);
    const signature = sign.sign(privateKey, 'base64url');

    return `${signatureInput}.${signature}`;
  }

  /**
   * Retrieve Google OAuth2 Access Token using assertion JWT
   */
  private static async getAccessToken(clientEmail: string, privateKey: string): Promise<string> {
    const jwt = this.signJWT(clientEmail, privateKey);
    
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Google OAuth token retrieval failed: ${response.status} ${errText}`);
    }

    const data = (await response.json()) as any;
    return data.access_token;
  }

  /**
   * Reads cell values from a Google Spreadsheet sheet range.
   */
  public static async getSpreadsheetData(spreadsheetId: string, range: string) {
    const credentials = this.getCredentials();
    
    if (!credentials || !credentials.client_email || !credentials.private_key) {
      return {
        configured: false,
        error: 'Google Service Account credentials are not configured.',
        clientEmail: 'No service account email found',
        headers: [],
        rows: []
      };
    }

    try {
      // 1. Get Google OAuth access token
      const accessToken = await this.getAccessToken(credentials.client_email, credentials.private_key);

      // 2. Fetch sheet values using native fetch
      const encodedRange = encodeURIComponent(range);
      const sheetUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodedRange}`;

      const response = await fetch(sheetUrl, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/json'
        }
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Sheets API responded with error: ${response.status} ${errText}`);
      }

      const responseData = (await response.json()) as any;
      const values = responseData.values;

      if (!values || values.length === 0) {
        return {
          configured: true,
          clientEmail: credentials.client_email,
          headers: [],
          rows: []
        };
      }

      const headers = values[0];
      const rows = values.slice(1).map((row: any[], idx: number) => {
        const rowData: Record<string, string> = { _rowId: String(idx + 1) };
        headers.forEach((header: string, index: number) => {
          rowData[header] = row[index] !== undefined ? String(row[index]) : '';
        });
        return rowData;
      });

      return {
        configured: true,
        clientEmail: credentials.client_email,
        headers,
        rows
      };
    } catch (err: any) {
      logger.error({ error: err.message }, 'Failed to fetch Google Sheet data');
      return {
        configured: true,
        error: `Failed to fetch Google Sheet: ${err.message}`,
        clientEmail: credentials.client_email,
        headers: [],
        rows: []
      };
    }
  }
}
