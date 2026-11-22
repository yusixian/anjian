import {
  WHITEBOARD_DEFAULT_PAGE,
  type WhiteboardPage,
  type WhiteboardScene,
} from '../../shared/whiteboard';
import { useTranslation } from '../i18n';
import { useWhiteboardFrame } from './useWhiteboardFrame';
import { WhiteboardCanvas } from './WhiteboardCanvas';
import { WhiteboardFrames } from './WhiteboardFrames';

export function SharedWhiteboard({
  scene,
  page,
  pageMissing,
  pages,
  onPage,
}: {
  scene: WhiteboardScene;
  page: string;
  pageMissing?: boolean;
  pages: WhiteboardPage[];
  onPage: (id: string) => void;
}) {
  const { t } = useTranslation();
  const [frame, setFrame] = useWhiteboardFrame();
  return (
    <div className="anjian-whiteboard-shared">
      {(pages.length > 1 || pageMissing) && (
        <div className="anjian-whiteboard-pages">
          <label>
            {t('whiteboard.page')}
            <select
              value={pageMissing ? '' : page}
              onChange={(event) => onPage(event.currentTarget.value)}
            >
              {pageMissing && (
                <option disabled value="">
                  {t('whiteboard.pageMissing')}
                </option>
              )}
              {pages.map(({ id, title }) => (
                <option key={id} value={id}>
                  {id === WHITEBOARD_DEFAULT_PAGE ? t('whiteboard.pageMain') : title}
                </option>
              ))}
            </select>
          </label>
          {pageMissing && (
            <button type="button" onClick={() => onPage(WHITEBOARD_DEFAULT_PAGE)}>
              {t('whiteboard.goToMain')}
            </button>
          )}
        </div>
      )}
      {!pageMissing && <WhiteboardFrames frame={frame} scene={scene} onFrame={setFrame} />}
      <WhiteboardCanvas readOnly frameId={pageMissing ? null : frame} scene={scene} />
    </div>
  );
}
