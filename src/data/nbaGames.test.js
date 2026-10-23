import { readFileSync } from 'fs';
import path from 'path';
import { PROP_SETS, CURATED_CONTEXT } from './nbaGames';

// A duplicate matchup key in an object literal does not error — the last one
// silently wins. That happened: a stale NY@BOS block below a freshly written
// one overrode it, and the board quietly served the old lines. The object
// cannot show this after the fact, so the source is checked directly.
describe('PROP_SETS has no duplicate matchup keys', () => {
  const source = readFileSync(path.join(__dirname, 'nbaGames.js'), 'utf8');

  test('each matchup appears exactly once in the source', () => {
    const keys = [...source.matchAll(/^ {2}'([A-Z]+@[A-Z]+)': \[/gm)].map((m) => m[1]);
    const duplicates = keys.filter((k, i) => keys.indexOf(k) !== i);
    expect(duplicates).toEqual([]);
    expect(keys.length).toBeGreaterThan(0);
  });

  test('every prop carries the fields settlement and pricing need', () => {
    Object.entries(PROP_SETS).forEach(([matchup, props]) => {
      props.forEach((prop) => {
        expect(typeof prop.id).toBe('string');
        expect(typeof prop.player).toBe('string');
        expect(typeof prop.stat).toBe('string');
        // A row is either a threshold with one price, or a line with two.
        if (prop.threshold != null) {
          expect(typeof prop.price).toBe('number');
        } else {
          expect(typeof prop.line).toBe('number');
          expect(typeof prop.over).toBe('number');
          expect(typeof prop.under).toBe('number');
        }
        // `baseline: null` is the documented way to say NO PLAY.
        if (prop.baseline !== null) {
          expect(prop.baseline.perGame).toBeGreaterThan(0);
          expect(prop.baseline.minutes).toBeGreaterThan(0);
        }
        expect(matchup).toMatch(/^[A-Z]+@[A-Z]+$/);
      });
    });
  });

  test('every curated context key is a matchup', () => {
    Object.keys(CURATED_CONTEXT).forEach((k) => expect(k).toMatch(/^[A-Z]+@[A-Z]+$/));
  });
});
