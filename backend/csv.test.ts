import { describe, it, expect } from 'vitest';
import { parseCsv, parseCsvRecords, toCsv } from './csv.js';

describe('csv', () => {
  it('hand-rolled parser handles quoted fields containing commas', () => {
    // TDD: csv-parse.test.ts — hand-rolled parser handles quoted fields containing commas | positive
    const text = 'name,description\n"Smith, John","a, b, c"\nPlain,simple';
    const recs = parseCsvRecords(text);
    expect(recs).toHaveLength(2);
    expect(recs[0].name).toBe('Smith, John');
    expect(recs[0].description).toBe('a, b, c');
    expect(recs[1].name).toBe('Plain');
    expect(recs[1].description).toBe('simple');
  });

  it('parses escaped double-quotes and roundtrips through toCsv', () => {
    // TDD: csv-parse.test.ts — hand-rolled parser handles quoted fields containing commas | positive
    const csv = toCsv(['a', 'b'], [['he said "hi"', 'x,y'], ['plain', 'z']]);
    const rows = parseCsv(csv);
    expect(rows[1]).toEqual(['he said "hi"', 'x,y']);
    expect(rows[2]).toEqual(['plain', 'z']);
  });
});
