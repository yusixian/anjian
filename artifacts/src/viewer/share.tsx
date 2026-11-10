import './layers.css';
import './share/share.css';
import '@lobehub/ui/theme.css';
import '@lobehub/ui/style.css';
import '../shared/fonts.css';

import { ConfigProvider, ContextMenuHost } from '@lobehub/ui';
import { motion } from 'motion/react';
import { createRoot } from 'react-dom/client';

import { useSystemTheme } from './hooks/useSystemTheme';
import { SharePage } from './share/SharePage';

function App() {
  useSystemTheme();
  return (
    <ConfigProvider motion={motion}>
      <SharePage />
      <ContextMenuHost />
    </ConfigProvider>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
