'use strict';

/**
 * Places where InvenTree's responses differ from its own published OpenAPI schema, found on the
 * public demo (API 583) on 2026-11-24. Each rule matches only the exact shape observed, so any other
 * schema error is still reported as a contract violation. Each has a test.fail test in
 * tests/contract.spec.js that turns red if the deviation ever goes away.
 *
 * match(error, value): error is an AJV error, value the offending value in the response.
 */
module.exports = [
  {
    id: 'CONTRACT-001',
    title: 'Timestamps are not RFC 3339 date-time values',
    expected: 'format date-time (e.g. 2024-07-27T05:08:00Z)',
    observed: '"2024-07-27 05:08": space instead of T, no seconds, no time zone',
    match: (e, v) => e.keyword === 'format' && e.params.format === 'date-time'
      && typeof v === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(v),
  },
  {
    id: 'CONTRACT-002',
    title: 'Image URLs are relative paths, the schema says absolute URI',
    expected: 'format uri (absolute, with scheme and host)',
    observed: '"/media/part_images/1551mini-photo.jpg"',
    match: (e, v) => e.keyword === 'format' && e.params.format === 'uri' && typeof v === 'string' && v.startsWith('/'),
  },
  {
    id: 'CONTRACT-003',
    title: 'Decimal fields are returned as JSON numbers, the schema says decimal strings',
    expected: 'type string with format decimal (e.g. "1300.00"), or null',
    observed: 'total_price 1300, purchase_price, pricing_min and pricing_max as numbers',
    // Matched by the schema itself (format: decimal), not by field name. Needs AJV's verbose mode.
    match: (e, v) => e.keyword === 'type' && typeof v === 'number' && !!e.parentSchema && e.parentSchema.format === 'decimal',
  },
];
