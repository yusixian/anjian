import { useId } from 'react';

import { ANJIAN_MARK_VIEWBOX,anjianMarkBody } from '../../shared/brand';

export function AnjianMark({ size = 16, color }: { size?: number; color?: string }) {
  const id = useId();
  return (
    <svg
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: anjianMarkBody(id) }}
      fill="currentColor"
      height={size}
      style={{ flex: 'none', display: 'block', color }}
      viewBox={ANJIAN_MARK_VIEWBOX}
      width={size}
    />
  );
}
