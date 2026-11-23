// schema-export.ts — D1 catalogue → the KYP v2 JSON the founder downloads.
//
// The dashboard edits products/specs in D1 (2026-11-23); this rebuilds a file
// of the SAME shape as `resources/json/kyp/bui_milling_vendor_kyp_schema_v2.json`
// so the download can be committed straight back as the source of truth:
// root `properties`/`required`, one `allOf` branch per product binding
// `product_key → category`, `aliases` default and `specs: {$ref}`.
import type { LiveCatalog, LiveProduct } from './catalog-live';

const INTRO = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: 'https://bui.internal/schemas/milling-spares-vendor-kyp.schema.json',
};

function propFor(prop: {
  type: string;
  enum?: string[];
  min?: number;
  max?: number;
  gt?: number;
  minLen?: number;
  default?: string | number | boolean;
}) {
  const out: Record<string, unknown> = {};
  out.type = prop.type === 'array' ? 'array' : prop.type;
  if (prop.type === 'array') out.items = { type: 'string' };
  if (prop.enum?.length) out.enum = prop.enum;
  if (typeof prop.min === 'number') {
    if (prop.type === 'string') out.minLength = prop.min;
    else out.minimum = prop.min;
  }
  if (typeof prop.max === 'number') out.maximum = prop.max;
  if (typeof prop.gt === 'number') out.exclusiveMinimum = prop.gt;
  if (typeof prop.minLen === 'number') out.minLength = prop.minLen;
  if (prop.default !== undefined) out.default = prop.default;
  return out;
}

function definitionFor(product: LiveProduct) {
  const properties: Record<string, unknown> = {};
  for (const [key, prop] of Object.entries(product.props)) properties[key] = propFor(prop);
  const def: Record<string, unknown> = {
    type: 'object',
    additionalProperties: false,
    'x-category': product.category,
    'x-aliases': product.aliases,
    properties,
  };
  if (product.required.length) def.required = product.required;
  // Rebuild the if/then bounds grouped per source key.
  const grouped = new Map<string, { whenKey: string; whenValue: string; key: string; min?: number; max?: number }[]>();
  for (const rule of product.rules ?? []) {
    const list = grouped.get(`${rule.whenKey}\u0000${rule.whenValue}`) ?? [];
    list.push(rule);
    grouped.set(`${rule.whenKey}\u0000${rule.whenValue}`, list);
  }
  if (grouped.size) {
    def.allOf = [...grouped.values()].map((rules) => {
      const thenProps: Record<string, unknown> = {};
      for (const r of rules) {
        thenProps[r.key] = {
          ...(typeof r.min === 'number' ? { minimum: r.min } : {}),
          ...(typeof r.max === 'number' ? { maximum: r.max } : {}),
        };
      }
      return {
        if: { properties: { [rules[0].whenKey]: { const: rules[0].whenValue } } },
        then: { properties: thenProps },
      };
    });
  }
  return def;
}

export function buildKypSchema(catalog: LiveCatalog): Record<string, unknown> {
  const categoryEnum = catalog.categories;
  const definitions: Record<string, unknown> = {};
  const allOf: unknown[] = [];

  for (const product of catalog.products) {
    definitions[product.key] = definitionFor(product);
    const cats = [...new Set([product.category, ...(product.categories ?? [])])];
    allOf.push({
      if: { properties: { product_key: { const: product.key } }, required: ['product_key'] },
      then: {
        properties: {
          category: cats.length > 1 ? { enum: cats } : { const: cats[0] },
          aliases: { default: product.aliases },
          specs: { $ref: `#/definitions/${product.key}` },
        },
      },
    });
  }

  return {
    ...INTRO,
    title: 'BUI Milling Spares Vendor-Side Catalog & KYP Schema',
    description:
      'Strict Draft-07 JSON Schema for the vendor-side catalogue: product identity, aliases, ' +
      'commercial/packaging/logistics envelope and per-product typechecked specs. ' +
      `Generated from the dashboard on ${new Date().toISOString().slice(0, 10)} (${catalog.products.length} products).`,
    type: 'object',
    additionalProperties: false,
    required: [
      'category', 'product_key', 'aliases', 'unit_of_sale', 'moq', 'price_per_unit',
      'delivery_time_days', 'vendor_name', 'contact_person', 'contact_number_1', 'location',
      'vendor_type', 'date_added', 'specs',
    ],
    properties: {
      category: { type: 'string', enum: categoryEnum },
      product_key: { type: 'string', enum: catalog.products.map((p) => p.key) },
      aliases: {
        type: 'array',
        description: 'Indian mandi / mill-store and Western OEM aliases for search and matching.',
        items: { type: 'string', minLength: 1 },
        uniqueItems: true,
      },
      brand: { type: ['string', 'null'] },
      material: { type: ['string', 'null'] },
      machine_make_model: { type: ['string', 'null'] },
      unit_of_sale: {
        type: 'string',
        enum: ['pcs', 'meter', 'sq_meter', 'kg', 'set', 'pair', 'packet', 'box', 'roll', 'bale', 'sheet'],
      },
      moq: { type: 'integer', minimum: 1, default: 1 },
      price_per_unit: { type: 'number', exclusiveMinimum: 0, description: 'Base price per unit in INR (excluding taxes).' },
      discount_percent: { type: 'number', minimum: 0, maximum: 100, default: 0 },
      weight_per_unit_kg: { type: ['number', 'null'], exclusiveMinimum: 0 },
      package_quantity: { type: ['integer', 'null'], minimum: 1 },
      package_dimensions: {
        type: ['object', 'null'],
        additionalProperties: false,
        properties: {
          length_cm: { type: 'number', exclusiveMinimum: 0 },
          width_cm: { type: 'number', exclusiveMinimum: 0 },
          height_cm: { type: 'number', exclusiveMinimum: 0 },
        },
        required: ['length_cm', 'width_cm', 'height_cm'],
      },
      delivery_time_days: { type: 'integer', minimum: 0 },
      delivery_time_max_days: { type: ['integer', 'null'], minimum: 0 },
      vendor_name: { type: 'string', minLength: 1 },
      contact_person: { type: 'string', minLength: 1 },
      contact_number_1: { type: 'string', pattern: '^[+]?[0-9\\s\\-()]{7,20}$' },
      contact_number_2: { type: ['string', 'null'], pattern: '^[+]?[0-9\\s\\-()]{7,20}$' },
      location: { type: 'string', minLength: 1 },
      address: { type: ['string', 'null'], minLength: 1 },
      year_of_establishment: { type: ['integer', 'null'], minimum: 1800, maximum: 2100 },
      vendor_type: { type: 'string', enum: ['manufacturer', 'distributor', 'trader'] },
      date_added: { type: 'string', format: 'date' },
      has_reference_media: { type: 'boolean', default: false },
      specs: { type: 'object' },
    },
    definitions,
    allOf,
  };
}

export function schemaFileName(): string {
  return `bui_milling_vendor_kyp_schema_${new Date().toISOString().slice(0, 10)}.json`;
}
