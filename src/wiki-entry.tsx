import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { WikiPage } from '@/ui/wiki/WikiPage';
import { applyTheme, resolveTheme } from '@/lib/theme';

applyTheme(resolveTheme());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <WikiPage />
  </StrictMode>,
);
