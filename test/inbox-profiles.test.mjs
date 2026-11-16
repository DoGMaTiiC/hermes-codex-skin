// Fork tests: profile whitelist on top of the stock Universal Inbox (v1.13+).
//   node test/fork.test.mjs plugin.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const pluginPath = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(testDir, '..', 'codex-chat-look', 'plugin.js');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-fork-'));
const nodeModules = path.join(tmpRoot, 'node_modules');

fs.mkdirSync(path.join(nodeModules, '@hermes', 'plugin-sdk'), { recursive: true });
fs.writeFileSync(path.join(nodeModules, '@hermes', 'plugin-sdk', 'index.js'), [
  'export const host = globalThis.host || {};',
  'export const PALETTE_AREA = "palette";',
  'export const THEMES_AREA = "themes";',
  'export const queryClient = {};',
  'export function useQuery() { return null; }',
  'export function useValue() { return null; }',
  'export function profileColor(name) { return "#123456"; }',
  'export function profileColorSoft(color, alpha) { return "rgba(18,52,86," + alpha / 100 + ")"; }',
].join('\n'));
fs.writeFileSync(path.join(nodeModules, '@hermes', 'plugin-sdk', 'package.json'), JSON.stringify({
  name: '@hermes/plugin-sdk', version: '0.0.0', type: 'module', main: 'index.js',
  exports: { '.': './index.js' },
}));

fs.mkdirSync(path.join(nodeModules, 'react'), { recursive: true });
fs.writeFileSync(path.join(nodeModules, 'react', 'index.js'), [
  'export function useEffect() {}',
  'export function useRef() { return { current: null }; }',
  'export function useState(value) { return [value, function () {}]; }',
].join('\n'));
fs.writeFileSync(path.join(nodeModules, 'react', 'jsx-runtime.js'), [
  'export function jsx(type, props) { return { type, props: props || {} }; }',
].join('\n'));
fs.writeFileSync(path.join(nodeModules, 'react', 'package.json'), JSON.stringify({
  name: 'react', version: '0.0.0', type: 'module', main: 'index.js',
  exports: { '.': './index.js', './jsx-runtime': './jsx-runtime.js' },
}));

// ---- stubs -------------------------------------------------------------
let profiles = null;
const storage = {
  get(key, fallback = null) {
    if (key === 'inbox-profiles') return profiles;
    if (key === 'inbox') return 'on';
    if (key === 'universal-inbox') return true;
    return fallback;
  },
  set(key, value) {
    if (key === 'inbox-profiles') { profiles = value; return true; }
    if (key === 'universal-inbox') { return true; }
    return true;
  },
};

const el = () => ({
  nodeType: 1, style: {}, attrs: {}, children: [],
  append() {}, appendChild(child) { this.children.push(child); return child; },
  replaceChildren() {}, remove() {},
  setAttribute(name, value) { this.attrs[name] = String(value); },
  getAttribute(name) { return Object.hasOwn(this.attrs, name) ? this.attrs[name] : null; },
  querySelector: () => null, querySelectorAll: () => [], closest: () => null,
  addEventListener() {}, removeEventListener() {}, contains: () => false,
});

globalThis.document = globalThis.document || {
  body: el(), documentElement: el(), createElement: el,
  addEventListener() {}, removeEventListener() {},
  querySelector: () => null, querySelectorAll: () => [],
};
globalThis.window = globalThis.window || {
  addEventListener() {}, removeEventListener() {}, dispatchEvent: () => {},
  setTimeout, clearTimeout, requestAnimationFrame: cb => { try { cb() } catch {} return 1 },
  cancelAnimationFrame() {}, MutationObserver: class { observe() {} disconnect() {} },
  localStorage: { getItem: () => null },
  hermesDesktop: { api: async () => ({ sessions: [], total: 0 }), getAgentRoster: async () => ({ agents: [], sources: [] }) },
};

const routes = [
  { connectionId: 'c1', profile: 'default', targetProfile: 'default', mode: 'local' },
  { connectionId: 'c1', profile: 'mbl', targetProfile: 'mbl', mode: 'local' },
  { connectionId: 'c2', profile: 'outro', targetProfile: 'outro', mode: 'remote' },
];
let rosterAnswer = {
  sources: [{ connectionId: 'c1', reachable: true }, { connectionId: 'c2', reachable: false }],
  agents: [
    { connectionId: 'c1', profile: 'default', targetProfile: 'default' },
    { connectionId: 'c1', profile: 'mbl', targetProfile: 'mbl' },
    { connectionId: 'c2', profile: 'outro', targetProfile: 'outro' },
  ],
};
let routeAnswer = routes;

globalThis.host = globalThis.host || {
  state: {
    connectionId: { get: () => 'c1' },
    profile: { get: () => 'default' },
    activeSessionId: { subscribe: () => () => {} },
    focusedStoredSessionId: { subscribe: () => () => {} },
    focusedSessionOwner: { subscribe: () => () => {} },
    focusedSessionProfile: { subscribe: () => () => {} },
    gateway: { get: () => 'open', subscribe: () => () => {} },
    busyBySession: { get: () => ({}) },
  },
  activeConnectionId: () => 'c1',
  profileRoutes: async () => routeAnswer,
  openSession() {}, notify() {},
};

globalThis.window.hermesDesktop.getAgentRoster = async () => rosterAnswer;
globalThis.pluginStorage = storage;

// ---- load the plugin with a seam --------------------------------------
const pluginSrc = fs.readFileSync(pluginPath, 'utf8');
const mjsPath = path.join(tmpRoot, 'plugin.mjs');
fs.writeFileSync(mjsPath, pluginSrc + '\n' + [
  'if (globalThis.pluginStorage) pluginStorage = globalThis.pluginStorage;',
  'export const __seam = {',
  '  readCodexInboxProfiles, isInboxAllProfiles, codexInboxProfileFilter, codexInboxProfileLabel,',
  '  setCodexInboxProfiles, readUniversalInboxInventory, readUniversalInbox, BUILD_ID,',
  '};',
  '',
].join('\n'));

const mod = await import(pathToFileURL(mjsPath).href);
const seam = mod.__seam;

// ---- assertions --------------------------------------------------------
test('plugin identity survives the fork', () => {
  assert.equal(mod.default.id, 'codex-chat-look');
  assert.equal(seam.BUILD_ID, 'v1.13.0');
});

test('no selection means every profile', () => {
  profiles = null;
  assert.equal(seam.readCodexInboxProfiles(), null);
  assert.equal(seam.codexInboxProfileFilter(), null);
  assert.equal(seam.codexInboxProfileLabel(), 'Todos');
});

test('wildcard selection also means every profile', () => {
  profiles = ['*'];
  assert.equal(seam.isInboxAllProfiles(seam.readCodexInboxProfiles()), true);
  assert.equal(seam.codexInboxProfileFilter(), null);
  assert.equal(seam.codexInboxProfileLabel(), 'Todos');
});

test('explicit selection becomes a filter set', () => {
  profiles = ['default', 'mbl', 'default', '  '];
  assert.deepEqual(seam.readCodexInboxProfiles(), ['default', 'mbl']);
  assert.deepEqual([...seam.codexInboxProfileFilter()], ['default', 'mbl']);
  assert.equal(seam.codexInboxProfileLabel(), 'default, mbl');
});

test('saving normalises and persists the selection', () => {
  profiles = null;
  assert.deepEqual(seam.setCodexInboxProfiles(['mbl', 'mbl', 'default']), ['mbl', 'default']);
  assert.deepEqual(profiles, ['mbl', 'default']);
  assert.equal(seam.setCodexInboxProfiles(null), null);
  assert.equal(profiles, null);
});

test('the inventory keeps only the selected profiles', async () => {
  profiles = ['default', 'mbl'];
  const inventory = await seam.readUniversalInboxInventory();
  assert.deepEqual(inventory.routes.map(item => item.route.profile), ['default', 'mbl']);
  // c2 is unreachable but hidden by the selection, so it cannot block the read.
  assert.equal(inventory.complete, true);
  assert.equal(inventory.ambiguous, false);
});

test('every profile still fails closed on an unreachable source', async () => {
  profiles = null;
  const inventory = await seam.readUniversalInboxInventory();
  assert.deepEqual(inventory.routes.map(item => item.route.profile), ['default', 'mbl']);
  assert.equal(inventory.complete, false);
  assert.equal(inventory.ambiguous, true);
});

test('ambiguity is scoped to the selected profiles', async () => {
  const savedRoutes = routeAnswer, savedRoster = rosterAnswer;
  // Two profiles resolve to the same backend alias, which the stock inventory
  // refuses to guess about. Selecting one of them makes it unambiguous again.
  routeAnswer = [
    { connectionId: 'c1', profile: 'default', targetProfile: 'shared', mode: 'local' },
    { connectionId: 'c1', profile: 'mbl', targetProfile: 'shared', mode: 'local' },
  ];
  rosterAnswer = {
    sources: [{ connectionId: 'c1', reachable: true }],
    agents: routeAnswer.map(route => ({ ...route })),
  };
  profiles = null;
  const all = await seam.readUniversalInboxInventory();
  assert.deepEqual(all.routes, []);
  assert.equal(all.complete, false);
  profiles = ['mbl'];
  const narrowed = await seam.readUniversalInboxInventory();
  assert.deepEqual(narrowed.routes.map(item => item.route.profile), ['mbl']);
  assert.equal(narrowed.complete, true);
  routeAnswer = savedRoutes;
  rosterAnswer = savedRoster;
});
