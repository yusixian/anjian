import * as stylex from '@stylexjs/stylex';
import { Languages } from 'lucide-react';

import { AnjianMark } from '../../components/AnjianMark';
import { setViewerLanguage, useTranslation } from '../../i18n';
import { styles } from './home-styles';
import { StatusPill } from './StatusPill';

export function WorkbenchHeader({ title, onProjectsChanged }: { title: string; onProjectsChanged: () => void }) {
  const { t, i18n } = useTranslation();
  return (
    <header {...stylex.props(styles.topbar)}>
      <div {...stylex.props(styles.breadcrumb)}>
        <AnjianMark size={20} />
        <strong {...stylex.props(styles.brand)}>案间</strong>
        <span {...stylex.props(styles.slash)}>/</span>
        <b {...stylex.props(styles.crumb)}>{title}</b>
      </div>
      <div {...stylex.props(styles.topbarEnd)}>
        <button
          aria-label={t('home.switchLanguage', { language: i18n.language === 'zh' ? 'English' : '中文' })}
          type="button"
          {...stylex.props(styles.languageButton)}
          onClick={() => void setViewerLanguage(i18n.language === 'zh' ? 'en' : 'zh')}
        >
          <Languages aria-hidden="true" size={14} />
          <span>{i18n.language === 'zh' ? '中文' : 'English'}</span>
        </button>
        <StatusPill onProjectsChanged={onProjectsChanged} />
      </div>
    </header>
  );
}
