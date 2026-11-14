// Groupify loading indicator: the logo itself is the loading ring.
// A blue arc travels around the "g" head, the shoulders breathe and the task dot pulses.
// Styles live in groupify.css (.g-loader).
export function loaderHtml(size = 44, label = 'Loading') {
  const height = Math.round(size * (6.4 / 5));
  return `<span class="g-loader" role="status" aria-label="${label}" style="width:${size}px;height:${height}px">
    <svg viewBox="-2.1 -2.1 5 6.4" width="${size}" height="${height}" aria-hidden="true">
      <circle class="g-loader-track" r="1.5" />
      <circle class="g-loader-arc" r="1.5" pathLength="100" />
      <path class="g-loader-shoulders" d="M-1.5 2.18 A1.5 1.5 0 0 0 1.5 2.18" />
      <circle class="g-loader-dot" cx="1.88" cy="-1.7" r="0.3" />
    </svg>
  </span>`;
}
