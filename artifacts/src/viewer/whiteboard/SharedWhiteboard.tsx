import type { WhiteboardScene } from '../../shared/whiteboard';
import { useWhiteboardFrame } from './useWhiteboardFrame';
import { WhiteboardCanvas } from './WhiteboardCanvas';
import { WhiteboardFrames } from './WhiteboardFrames';

export function SharedWhiteboard({ scene }: { scene: WhiteboardScene }) {
  const [frame, setFrame] = useWhiteboardFrame();
  return (
    <div className="anjian-whiteboard-shared">
      <WhiteboardFrames frame={frame} scene={scene} onFrame={setFrame} />
      <WhiteboardCanvas readOnly frameId={frame} scene={scene} />
    </div>
  );
}
