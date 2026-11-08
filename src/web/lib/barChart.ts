/** Single-series daily bars shared by the back-office dashboards. */
/** Single-series daily bars: one hue, rounded data-end on top, 2px gaps, hover tooltip. */
export function drawBars(
  host: HTMLElement,
  series: [string, number][],
  tipValue: (v: number) => string = (v) => `<b>${v}</b>`,
  label = '每日數值',
  tick: (v: number) => string = (v) => String(v),
) {
  // Drawn at the container's real width so axis text stays at its CSS size.
  const W = Math.max(280, host.clientWidth), H = 200, padL = 34, padB = 22, padT = 8;
  const max = Math.max(0, ...series.map(([, v]) => v)) || 1;
  const nice = (() => { const p = 10 ** Math.floor(Math.log10(max)); return Math.ceil(max / p) * p; })();
  const step = (W - padL) / series.length;
  const bw = Math.max(2, step - 2);
  const y = (v: number) => padT + (H - padT - padB) * (1 - v / nice);
  const ticks = [0, nice / 2, nice];
  const bar = (x: number, v: number) => {
    const top = y(v), base = H - padB, h = base - top;
    if (h <= 0) return '';
    const r = Math.min(4, h, bw / 2);
    return `M${x},${base}V${top + r}Q${x},${top} ${x + r},${top}H${x + bw - r}Q${x + bw},${top} ${x + bw},${top + r}V${base}Z`;
  };
  host.innerHTML = `
    <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="近 ${series.length} 天${label}">
      ${ticks.map((t) => `<line x1="${padL}" x2="${W}" y1="${y(t)}" y2="${y(t)}" class="grid"/><text x="${padL - 6}" y="${y(t) + 3}" class="ax" text-anchor="end">${tick(t)}</text>`).join('')}
      ${series.map(([d, v], i) => `<g data-i="${i}"><rect class="hit" x="${padL + i * step}" y="${padT}" width="${step}" height="${H - padT - padB}"/><path class="bar" d="${bar(padL + i * step + 1, v)}"/></g>`).join('')}
      ${[0, Math.floor(series.length / 2), series.length - 1].map((i) => `<text class="ax" x="${padL + i * step + step / 2}" y="${H - 6}" text-anchor="middle">${series[i][0].slice(5).replace('-', '.')}</text>`).join('')}
    </svg>
    <div class="tip" hidden></div>`;
  const tip = host.querySelector<HTMLElement>('.tip')!;
  const svg = host.querySelector('svg')!;
  svg.addEventListener('pointermove', (e) => {
    const g = (e.target as Element).closest('g[data-i]');
    for (const x of svg.querySelectorAll('g.on')) x.classList.remove('on');
    if (!g) { tip.hidden = true; return; }
    g.classList.add('on');
    const [d, v] = series[+g.getAttribute('data-i')!];
    tip.hidden = false;
    tip.innerHTML = `<span class="mono">${d}</span><span>${tipValue(v)}</span>`;
    const r = host.getBoundingClientRect();
    tip.style.left = `${Math.min(e.clientX - r.left + 12, r.width - 140)}px`;
    tip.style.top = `${e.clientY - r.top - 44}px`;
  });
  svg.addEventListener('pointerleave', () => { tip.hidden = true; for (const x of svg.querySelectorAll('g.on')) x.classList.remove('on'); });
}
