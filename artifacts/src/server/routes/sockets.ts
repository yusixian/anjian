import { guardSocket, socketAuthorized } from '../socket-access';
import { onClientText } from '../client-reports';
import type { ServerContext } from '../context';
import { completeHandshake, handleClientFrames } from '../ws';
import type { UpgradeRoute } from './table';

export const clientSocketRoute: UpgradeRoute<ServerContext> = {
  path: '/ws',
  auth: 'socket',
  handle: (req, socket, ctx, { clientKey, key }) => {
    guardSocket(socket, () => ctx.isAuthorized(req, key));
    if (!socketAuthorized(socket)) return;
    completeHandshake(socket, clientKey);
    ctx.clients.add(socket);
    handleClientFrames(socket, (text) => {
      if (socketAuthorized(socket)) onClientText(ctx, socket, text);
    });
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
