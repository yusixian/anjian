import { onClientText } from '../client-reports';
import type { ServerContext } from '../context';
import { completeHandshake, handleClientFrames } from '../ws';
import type { UpgradeRoute } from './table';

export const clientSocketRoute: UpgradeRoute<ServerContext> = {
  path: '/ws',
  auth: 'socket',
  handle: (_req, socket, ctx, { clientKey }) => {
    completeHandshake(socket, clientKey);
    ctx.clients.add(socket);
    handleClientFrames(socket, (text) => onClientText(ctx, socket, text));
    const forget = () => {
      ctx.clients.delete(socket);
      ctx.selections.drop(socket);
    };
    socket.on('end', () => {
      forget();
      socket.end();
    });
    socket.on('close', forget);
    socket.on('error', forget);
    ctx.touch();
  },
};
