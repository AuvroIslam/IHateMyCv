'use client';

import type { MeasuredElement, MeasuredLine } from './align-fit';

const PX_PER_PT = 96 / 72;

/**
 * Measures every `[data-role]` element on the rendered pages: each line's
 * baseline and horizontal extent, in points from its page's top-left corner.
 *
 * Baselines come from character boxes: a text box spans the font's ascent to
 * descent, so baseline = box bottom - descent, with the descent read from the
 * same font via canvas (the metric the browser used to size the box).
 */
export function measureRendered(root: ParentNode): MeasuredElement[] {
  const ctx = document.createElement('canvas').getContext('2d')!;
  const descentCache = new Map<string, number>();
  const descentOf = (el: Element) => {
    const cs = getComputedStyle(el);
    const font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    let d = descentCache.get(font);
    if (d == null) {
      ctx.font = font;
      d = ctx.measureText('Hg').fontBoundingBoxDescent;
      descentCache.set(font, d);
    }
    return d;
  };

  const out: MeasuredElement[] = [];
  const pages = Array.from(root.querySelectorAll<HTMLElement>('.cv-page'));
  pages.forEach((pageEl, page) => {
    const pageRect = pageEl.getBoundingClientRect();
    // Pages may be drawn scaled; everything is converted back to points.
    const scale = pageRect.width / pageEl.offsetWidth || 1;
    const toPt = (px: number) => px / scale / PX_PER_PT;

    for (const el of Array.from(pageEl.querySelectorAll<HTMLElement>('[data-role]'))) {
      const chars: { y: number; x: number; xEnd: number; ch: string }[] = [];
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      const range = document.createRange();
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = node.textContent ?? '';
        const descent = descentOf(node.parentElement!) * scale;
        for (let i = 0; i < text.length; i++) {
          if (!/[\p{L}\p{N}]/u.test(text[i])) continue;
          range.setStart(node, i);
          range.setEnd(node, i + 1);
          const r = range.getClientRects()[0];
          if (!r || r.width === 0) continue;
          chars.push({
            y: toPt(r.bottom - descent - pageRect.top),
            x: toPt(r.left - pageRect.left),
            xEnd: toPt(r.right - pageRect.left),
            ch: text[i],
          });
        }
      }
      if (!chars.length) continue;

      // Characters sharing a baseline form a line.
      const lines: MeasuredLine[] = [];
      for (const c of chars) {
        const line = lines.find((l) => Math.abs(l.y - c.y) < 1.5);
        if (line) {
          line.x = Math.min(line.x, c.x);
          line.xEnd = Math.max(line.xEnd, c.xEnd);
          line.key += c.ch.toLowerCase();
        } else {
          lines.push({ y: c.y, x: c.x, xEnd: c.xEnd, key: c.ch.toLowerCase() });
        }
      }
      lines.sort((a, b) => a.y - b.y);
      out.push({
        role: el.dataset.role!,
        page,
        // Block keys are "<sectionId>:<...>", so the block names the section.
        section: el.closest<HTMLElement>('[data-block]')?.dataset.block?.split(':')[0],
        ...(el.dataset.row ? { row: Number(el.dataset.row) } : {}),
        lines: lines.map((l) => ({ ...l, key: l.key.normalize('NFKD').replace(/[^a-z0-9]/g, '') })),
      });
    }
  });
  return out;
}
