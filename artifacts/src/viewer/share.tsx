import './layers.css';
import './share/share.css';
import '@lobehub/ui/theme.css';
import '../shared/fonts.css';

import { createRoot } from 'react-dom/client';

import { useSystemTheme } from './hooks/useSystemTheme';
import { SharePage } from './share/SharePage';

function App() {
  useSystemTheme();
  return <SharePage />;
}

createRoot(document.getElementById('root')!).render(<App />);
