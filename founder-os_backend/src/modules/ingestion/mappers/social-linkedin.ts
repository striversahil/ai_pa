// social-linkedin.ts — LinkedIn lead-gen form pushes (manifest fieldMap).

import type { Mapper } from './types';
import { genericMapper } from './generic';

export const mapSocialLinkedIn: Mapper = (payload, ctx) => genericMapper('linkedin')(payload, ctx);
