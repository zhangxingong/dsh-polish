/** 四角星图标：细线空心 + 四角顶点小圆点（浅灰 currentColor，无填充）。 */
import { createElement } from 'react'

export function StarIcon() {
  return createElement(
    'svg',
    { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
    createElement('path', {
      d: 'M8 1.8 L9.4 6.6 L14.2 8 L9.4 9.4 L8 14.2 L6.6 9.4 L1.8 8 L6.6 6.6 Z',
      stroke: 'currentColor',
      strokeWidth: 1.2,
      strokeLinejoin: 'round',
      fill: 'none',
    }),
    createElement('circle', { cx: 8, cy: 1.8, r: 1, fill: 'currentColor' }),
    createElement('circle', { cx: 14.2, cy: 8, r: 1, fill: 'currentColor' }),
    createElement('circle', { cx: 8, cy: 14.2, r: 1, fill: 'currentColor' }),
    createElement('circle', { cx: 1.8, cy: 8, r: 1, fill: 'currentColor' }),
  )
}
