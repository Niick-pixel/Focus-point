const test = require('node:test');
const assert = require('node:assert');
const { shouldBlock, VK } = require('../src/main/keyblock');

const key = (vk, mods = {}) => shouldBlock({ vk, alt: false, ctrl: false, shift: false, ...mods });

test('strict mode blocks the escape shortcuts', () => {
  assert.ok(key(VK.TAB, { alt: true }), 'Alt+Tab');
  assert.ok(key(VK.TAB, { alt: true, shift: true }), 'Alt+Shift+Tab');
  assert.ok(key(VK.LWIN) && key(VK.RWIN), 'Windows key');
  assert.ok(key(VK.ESCAPE, { alt: true }), 'Alt+Esc');
  assert.ok(key(VK.ESCAPE, { ctrl: true }), 'Ctrl+Esc');
  assert.ok(key(VK.F4, { alt: true }), 'Alt+F4');
  assert.ok(key(VK.SPACE, { alt: true }), 'Alt+Space');
});

test('strict mode leaves safety keys and normal typing alone', () => {
  assert.ok(!key(VK.ESCAPE), 'plain Esc (emergency exit)');
  assert.ok(!key(VK.ESCAPE, { ctrl: true, shift: true }), 'Ctrl+Shift+Esc (Task Manager)');
  assert.ok(!key(VK.TAB), 'plain Tab (keyboard navigation)');
  assert.ok(!key(0x41), 'letters');
  assert.ok(!key(VK.F4), 'plain F4');
});
