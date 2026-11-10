import { expect, test } from 'vitest';
import { publicAddress, safeLookup, storageAgent } from '../src/server/storage/network';

test('network policy rejects private, mapped, multicast and reserved addresses', () => {
  for (const address of ['0.0.0.0', '10.1.2.3', '100.64.0.1', '127.0.0.1', '169.254.169.254', '172.16.1.1', '192.168.1.1', '192.0.2.1', '198.18.0.1', '203.0.113.1', '224.0.0.1', '255.255.255.255', '::', '::1', '::ffff:127.0.0.1', '::ffff:8.8.8.8', 'fc00::1', 'fe80::1', 'ff02::1', '2001:db8::1', '2002:7f00:1::', '64:ff9b::7f00:1', '3fff::1', 'not-an-ip'])
    expect(publicAddress(address), address).toBe(false);
  for (const address of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111', '2001:4860:4860::8888']) expect(publicAddress(address), address).toBe(true);
  expect(() => storageAgent('[::1]')).toThrow();
  expect(() => storageAgent('127.0.0.1')).toThrow();
});

test('connection lookup returns validated addresses directly and rejects mixed or rebound answers', async () => {
  let addresses = [{ address: '8.8.8.8', family: 4 }];
  const lookup = safeLookup('objects.example', async () => addresses);
  const resolve = (hostname = 'objects.example', all = true) => new Promise((accept, reject) => {
    lookup(hostname, { all }, (error, value) => error ? reject(error) : accept(value));
  });
  await expect(resolve()).resolves.toEqual(addresses);
  await expect(resolve('another.example')).rejects.toThrow('公网');
  addresses = [...addresses, { address: '127.0.0.1', family: 4 }];
  await expect(resolve()).rejects.toThrow('公网');
  addresses = [{ address: '169.254.169.254', family: 4 }];
  await expect(resolve()).rejects.toThrow('公网');
  addresses = [];
  await expect(resolve()).rejects.toThrow('公网');
});
