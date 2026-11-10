import { isIP } from 'node:net';
import { S3Client } from '@aws-sdk/client-s3';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import type { S3Credentials, S3Settings } from './settings';
import { storageAgent } from './network';

/** All object traffic uses the same endpoint and DNS restrictions as connection tests. */
export function createStorageClient(settings: S3Settings, credentials: S3Credentials, timeoutMs = 15000) {
  const endpoint = new URL(settings.endpoint);
  const forcePathStyle = settings.forcePathStyle || settings.bucket.includes('.') || Boolean(isIP(endpoint.hostname.replace(/^\[|\]$/g, '')));
  const expectedHost = (forcePathStyle ? endpoint.hostname : `${settings.bucket}.${endpoint.hostname}`).replace(/^\[|\]$/g, '');
  const agent = storageAgent(expectedHost);
  const handler = new NodeHttpHandler({ httpsAgent: agent, connectionTimeout: 5000, requestTimeout: timeoutMs, throwOnRequestTimeout: true, socketTimeout: 10000 });
  const client = new S3Client({ endpoint: settings.endpoint, region: settings.region, credentials,
    forcePathStyle, followRegionRedirects: false, maxAttempts: 1,
    requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED',
    requestHandler: {
      handle(...args: Parameters<NodeHttpHandler['handle']>) {
        const [request, options] = args;
        if (request.protocol !== 'https:' || request.hostname.replace(/^\[|\]$/g, '') !== expectedHost || (request.port ?? 443) !== Number(endpoint.port || 443))
          throw new Error('S3 endpoint changed');
        return handler.handle(request, options);
      },
    },
  });
  return { client, close() { client.destroy(); handler.destroy(); agent.destroy(); } };
}
