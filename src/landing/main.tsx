import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';
import './landing.css';
import { LandingPage } from './LandingPage';

// The landing page is monochrome. `landing.css` redefines the app's `--tm-*`
// tokens on bare `:root` in greyscale (it loads after index.css, so source
// order wins) — so the embedded live-demo pane and its uPlot charts render in
// paper/ink regardless of the visitor's OS theme. No `data-theme` attribute is
// set, which is what keeps that override from being out-specified.

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LandingPage />
  </StrictMode>,
);
