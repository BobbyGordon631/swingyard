import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../public/js/config.js';
import { PhoneSource, BUTTON_BITS } from '../public/js/input/phoneSource.js';

// Button presses come on a reliable channel, motion samples (which repeat the button bits) on an unordered
// one. A late motion packet from before the latest press / release must not undo it.
test('phone buttons: a stale packet cannot undo a newer press or release', () => {
  const p = new PhoneSource(0, () => {}, CONFIG);
  const left = BUTTON_BITS.left;
  p.handleMessage({ t: 'm', b: left, bs: 100 }, 0);
  assert.equal(p.buttons.left, true);
  p.handleMessage({ t: 'm', b: 0, bs: 101 }, 0); // released
  assert.equal(p.buttons.left, false);
  p.handleMessage({ t: 'm', b: left, bs: 100 }, 0); // a late motion packet from while it was held
  assert.equal(p.buttons.left, false, 'the release stands');
  p.handleMessage({ t: 'm', b: left, bs: 102 }, 0);
  assert.equal(p.buttons.left, true);
});

test('phone buttons: a reloaded controller page (new sequence) is accepted', () => {
  const p = new PhoneSource(0, () => {}, CONFIG);
  p.handleMessage({ t: 'm', b: BUTTON_BITS.a, bs: 900000 }, 0);
  p.handleMessage({ t: 'm', b: 0, bs: 12 }, 0); // fresh page, random low start
  assert.equal(p.buttons.a, false);
  p.handleMessage({ t: 'm', b: BUTTON_BITS.a }, 0); // an old controller page without sequence numbers
  assert.equal(p.buttons.a, true);
});
