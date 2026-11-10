import { lookup } from 'node:dns/promises';
import { Agent } from 'node:https';
import { BlockList, isIP, type LookupFunction } from 'node:net';

const denied = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) denied.addSubnet(address, prefix, 'ipv4');
const globalV6 = new BlockList(); globalV6.addSubnet('2000::', 3, 'ipv6');
for (const [address, prefix] of [['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20]] as const)
  denied.addSubnet(address, prefix, 'ipv6');

export function publicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !denied.check(address, 'ipv4');
  if (family === 6) return globalV6.check(address, 'ipv6') && !denied.check(address, 'ipv6');
  return false;
}
export class StorageNetworkError extends Error {
  constructor() { super('S3 地址必须解析到公网地址，不能访问内网或保留地址。'); }
}
export type ResolveAddresses = (hostname: string) => Promise<Array<{ address: string; family: number }>>;
export const resolveAddresses: ResolveAddresses = (hostname) => lookup(hostname, { all: true, verbatim: true });

export function safeLookup(expectedHost: string, resolve: ResolveAddresses = resolveAddresses): LookupFunction {
  return (hostname, options, callback) => {
    if (hostname !== expectedHost) { callback(new StorageNetworkError(), ''); return; }
    let finished = false;
    const finish: Parameters<LookupFunction>[2] = (...args) => {
      if (finished) return;
      finished = true; clearTimeout(timer); callback(...args);
    };
    const timer = setTimeout(() => finish(new StorageNetworkError(), ''), 5000);
    void resolve(hostname).then((addresses) => {
      if (!addresses.length || addresses.some((item) => !publicAddress(item.address))) throw new StorageNetworkError();
      const candidates = options.family ? addresses.filter((a) => a.family === options.family) : addresses;
      if (!candidates.length) throw new StorageNetworkError();
      // These validated addresses are passed directly to connect; there is no second DNS lookup.
      if (options.all) finish(null, candidates);
      else finish(null, candidates[0]!.address, candidates[0]!.family);
    }).catch(() => finish(new StorageNetworkError(), ''));
  };
}

export function storageAgent(hostname: string) {
  const host = hostname.replace(/^\[|\]$/g, '');
  if (isIP(host) && !publicAddress(host)) throw new StorageNetworkError();
  return new Agent({ keepAlive: false, maxSockets: 4, lookup: safeLookup(host), rejectUnauthorized: true });
}
