import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';

// Read-only embeddable widget entry. Wired up in the Export + embed phase:
// reads a design from `?d=<lz-string>` or `?preset=<name>`, renders a read-only
// canvas + compact metrics strip, and auto-plays a scenario.
function Embed() {
  return (
    <div className="flex h-full items-center justify-center text-sm text-neutral-400">
      Breakpoint embed — not yet implemented
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Embed />
  </StrictMode>,
);
