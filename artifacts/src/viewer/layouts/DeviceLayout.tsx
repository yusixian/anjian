import { toast } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { useEffect } from 'react';

import { useTranslation } from '../i18n';
import { DevicePage } from './DevicePage';
import { styles } from './home/home-styles';
import { ProjectSidebar } from './home/ProjectSidebar';
import { useHubArtifacts } from './home/useHubArtifacts';
import { useTrash } from './home/useTrash';
import { WorkbenchHeader } from './home/WorkbenchHeader';

export function DeviceLayout({ connect }: { connect: boolean }) {
  const { t } = useTranslation();
  const { list, refresh, removeProject } = useHubArtifacts();
  const trash = useTrash();
  const title = connect ? t('devices.connectTitle') : t('home.devices');
  useEffect(() => { document.title = `${title} · 案间`; }, [title]);
  const artifacts = list?.artifacts ?? [];
  const projects = (list?.projects ?? []).map((p) => ({ ...p, artifacts: artifacts.filter((a) => a.project === p.dir).length }));
  return (
    <div {...stylex.props(styles.library)}>
      <WorkbenchHeader title={title} onProjectsChanged={() => void refresh()} />
      <div {...stylex.props(styles.body)}>
        <ProjectSidebar
          projects={projects}
          total={artifacts.length}
          trashCount={trash.entries?.length ?? 0}
          selection="devices"
          onSelect={(next) => location.assign(next === 'recent' ? '/' : next === 'trash' ? '/?view=trash' : `/?project=${encodeURIComponent(next)}`)}
          onRemove={(project) => void removeProject(project.dir).catch(() => toast.error(t('home.removeFailed', { name: project.name })))}
        />
        <main {...stylex.props(styles.main)}><DevicePage connect={connect} /></main>
      </div>
    </div>
  );
}
