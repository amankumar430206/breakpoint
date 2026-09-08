import { toPng, toSvg } from 'html-to-image';
import { triggerDownload } from './download';

function target(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.react-flow');
}

const opts = () => ({
  backgroundColor: getComputedStyle(document.body).backgroundColor || '#0b0e14',
  pixelRatio: 2,
  filter: (node: Element) =>
    !(node instanceof Element) ||
    !node.classList?.contains('react-flow__panel') /* hide the controls / attribution */,
});

export async function exportCanvasPng(filename: string): Promise<void> {
  const el = target();
  if (!el) return;
  triggerDownload(filename, await toPng(el, opts()));
}

export async function exportCanvasSvg(filename: string): Promise<void> {
  const el = target();
  if (!el) return;
  triggerDownload(filename, await toSvg(el, opts()));
}
