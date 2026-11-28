// custom.ts — customer-defined shape. The manifest fieldMap is the default;
// config.fieldMapJson is honoured by generic.ts when the instance supplies it.

import type { Mapper } from './types';
import { genericMapper } from './generic';

export const mapCustom: Mapper = (payload, ctx) => genericMapper('custom')(payload, ctx);
