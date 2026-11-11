// Groupify logo, built from the brand guidelines' construction:
// head ring + shoulders arc = a person (the "g"), the dot = a task.

export function GroupifyMark({ size = 28, color = 'currentColor', dot = null, title = 'Groupify' }) {
  return (
    <svg width={size} height={size * (6.4 / 5)} viewBox="-2.1 -2.1 5 6.4" role="img" aria-label={title}>
      <circle r="1.5" fill="none" stroke={color} strokeWidth="1" />
      <path d="M-1.5 2.18 A1.5 1.5 0 0 0 1.5 2.18" fill="none" stroke={color} strokeWidth="1" />
      <circle cx="1.88" cy="-1.7" r="0.3" fill={dot || color} />
    </svg>
  );
}

export default function GroupifyLogo({ height = 26, color = 'currentColor', dot = null, title = 'Groupify' }) {
  return (
    <svg height={height} viewBox="-2.1 -3.7 34 8" role="img" aria-label={title} className="groupify-logo">
      <circle r="1.5" fill="none" stroke={color} strokeWidth="1" />
      <path d="M-1.5 2.18 A1.5 1.5 0 0 0 1.5 2.18" fill="none" stroke={color} strokeWidth="1" />
      <circle cx="1.88" cy="-1.7" r="0.3" fill={dot || color} />
      <text x="2.75" y="2" fontFamily="Geist, sans-serif" fontWeight="700" fontSize="7.4" letterSpacing="-0.22" fill={color}>roupify</text>
    </svg>
  );
}
