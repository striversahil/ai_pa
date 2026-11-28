// google-maps.ts — Places + Routes with the instance's own key, region bias.

import { IntegrationError, type IntegrationAdapter, type ResolvedInstance } from '../types';

export interface GoogleMapsClient {
  searchPlaces(textQuery: string, opts?: { maxResultCount?: number; lat?: number; lng?: number }): Promise<any[]>;
  computeRoutes(origin: string, destination: string, opts?: { travelMode?: string }): Promise<any>;
  ping(): Promise<{ ok: boolean }>;
}

export const googleMapsAdapter: IntegrationAdapter<GoogleMapsClient> = {
  provider: 'google_maps',
  async connect(instance: ResolvedInstance): Promise<GoogleMapsClient> {
    const cfg = instance.config as Record<string, any>;
    const key = instance.secrets.apiKey;
    const regionCode = String(cfg.regionCode || 'IN');
    const languageCode = String(cfg.languageCode || 'en');
    if (!key) throw new IntegrationError('google_maps', 'instance is missing apiKey', 409);

    async function post<T>(url: string, body: unknown, fieldMask: string): Promise<T> {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': key,
          'X-Goog-FieldMask': fieldMask,
        },
        body: JSON.stringify(body),
      });
      const data: any = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new IntegrationError('google_maps', `Maps ${res.status}: ${data?.error?.message || ''}`, res.status === 429 ? 429 : 502);
      }
      return data as T;
    }

    return {
      async searchPlaces(textQuery, opts = {}) {
        const body: Record<string, unknown> = {
          textQuery,
          languageCode,
          regionCode,
          pageSize: Math.min(opts.maxResultCount ?? 10, 20),
        };
        if (opts.lat !== undefined && opts.lng !== undefined) {
          body.locationBias = { circle: { center: { latitude: opts.lat, longitude: opts.lng }, radius: 50000 } };
        }
        const data = await post<any>(
          'https://places.googleapis.com/v1/places:searchText',
          body,
          'places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.websiteUri,places.rating',
        );
        return data?.places ?? [];
      },
      async computeRoutes(origin, destination, opts = {}) {
        return post<any>(
          'https://routes.googleapis.com/directions/v2:computeRoutes',
          { origin: { address: origin }, destination: { address: destination }, travelMode: opts.travelMode || 'DRIVE', regionCode },
          'routes.distanceMeters,routes.duration,routes.legs.steps.navigationInstruction',
        );
      },
      async ping() {
        await post('https://places.googleapis.com/v1/places:searchText', { textQuery: 'test', pageSize: 1 }, 'places.id');
        return { ok: true };
      },
    };
  },
};
