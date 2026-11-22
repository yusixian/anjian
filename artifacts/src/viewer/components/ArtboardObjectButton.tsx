import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { Check, Square } from 'lucide-react';

import type { SelectedArtboardObject } from '../../shared/selection';
import { t } from '../i18n';

export interface ArtboardObjectPicker {
  objects: SelectedArtboardObject[];
  toggle: (object: SelectedArtboardObject) => void;
}

const styles = stylex.create({
  button: {
    position: 'absolute',
    width: 32,
    height: 32,
    display: 'grid',
    placeItems: 'center',
    border: `1px solid ${cssVar.colorBorder}`,
    borderRadius: 8,
    color: cssVar.colorText,
    backgroundColor: cssVar.colorBgContainer,
    transformOrigin: 'top left',
    touchAction: 'none',
    cursor: 'pointer',
    zIndex: 6,
  },
  selected: {
    color: cssVar.colorInfoText,
    backgroundColor: cssVar.colorInfoBg,
  },
});

export function ArtboardObjectButton({
  object, picker, title, x, y, zoom,
}: {
  object: SelectedArtboardObject;
  picker: ArtboardObjectPicker;
  title: string;
  x: number;
  y: number;
  zoom: number;
}) {
  const selected = picker.objects.some(({ id, kind }) => id === object.id && kind === object.kind);
  const label = t('canvasObjects.selectObject', { title });
  return (
    <button
      {...stylex.props(styles.button, selected && styles.selected)}
      aria-label={label}
      aria-pressed={selected}
      data-select-object={`${object.kind}/${object.id}`}
      style={{ left: x, top: y, transform: `scale(${1 / zoom})` }}
      title={label}
      type="button"
      onPointerDown={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        picker.toggle(object);
      }}
    >
      {selected ? <Check aria-hidden="true" size={16} /> : <Square aria-hidden="true" size={15} />}
    </button>
  );
}
