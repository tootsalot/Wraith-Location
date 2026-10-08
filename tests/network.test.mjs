import test from 'node:test';
import assert from 'node:assert/strict';
import {wifiStatus} from '../backend/network.mjs';
const ip = address => ({address, internal: false});
test('Mac Wi-Fi requires an address on the Wi-Fi interface, not Ethernet or a self-assigned address', async () => {
  const runner = async () => ({code: 0, stdout: 'Hardware Port: Ethernet\nDevice: en0\n\nHardware Port: Wi-Fi\nDevice: en1\n'});
  for (const [interfaces, expected] of [[{en0: [ip('192.168.1.2')]}, false], [{en1: [ip('169.254.1.2')]}, false], [{en1: [ip('192.168.1.2')]}, true]]) {
    assert.deepEqual(await wifiStatus({platform: 'darwin', runner, interfaces: () => interfaces}), {wifi: expected});
  }
});
test('Windows handles single and multiple active wireless adapters', async () => {
  for (const stdout of ['"Wi-Fi"', '["Wi-Fi", "Wireless 2"]', '\uFEFF"Wi-Fi"']) {
    const result = await wifiStatus({platform: 'win32', runner: async () => ({code: 0, stdout}), interfaces: () => ({'Wi-Fi': [ip('10.0.0.2')]})});
    assert.deepEqual(result, {wifi: true});
  }
  assert.deepEqual(await wifiStatus({platform: 'win32', runner: async () => ({code: 0, stdout: ''})}), {wifi: false});
});
test('Linux finds Wi-Fi from sysfs and ignores wired, self-assigned and unusual interface names', async () => {
  const wireless = new Set(['/sys/class/net/wlp2s0/wireless', '/sys/class/net/wlan0/wireless']);
  const exists = file => wireless.has(file);
  const check = interfaces => wifiStatus({platform: 'linux', exists, interfaces: () => interfaces});
  assert.deepEqual(await check({eth0: [ip('192.168.1.2')]}), {wifi: false});
  assert.deepEqual(await check({wlp2s0: [ip('169.254.3.4'), ip('fe80::1')]}), {wifi: false});
  assert.deepEqual(await check({eth0: [ip('192.168.1.2')], wlp2s0: [ip('192.168.1.3')]}), {wifi: true});
  assert.deepEqual(await check({'../wlan0': [ip('10.0.0.2')]}), {wifi: false});
});
