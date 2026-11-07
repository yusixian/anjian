import { ANJIAN_MARK_BODY, ANJIAN_MARK_VIEWBOX } from '../../shared/brand';

export function AnjianMark({ size = 16, color }: { size?: number; color?: string }) {
  return (
    <svg
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: ANJIAN_MARK_BODY }}
      fill="currentColor"
      height={size}
      style={{ flex: 'none', display: 'block', color }}
      viewBox={ANJIAN_MARK_VIEWBOX}
      width={size}
    />
  );
}
