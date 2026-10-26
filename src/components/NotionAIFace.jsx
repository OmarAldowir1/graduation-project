export default function NotionAIFace({
  size = 28,
  className = '',
  bg = 'bg-[#e5e5e4] dark:bg-[#343536]',
  stroke = '#191919',
  strokeDark = '#f5f5f4'
}) {
  return (
    <div
      style={{ width: size, height: size }}
      className={`rounded-full flex items-center justify-center shrink-0 overflow-hidden shadow-xs border border-black/5 dark:border-white/10 select-none ${bg} ${className}`}
      aria-hidden="true"
    >
      <svg
        viewBox="0 0 36 36"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style={{ width: size * 0.78, height: size * 0.78 }}
        className="text-[#191919] dark:text-[#f5f5f4]"
      >
        {/* Left eyebrow & eye */}
        <path
          d="M 9.5 12.5 C 10.5 9.8 13.5 9.8 14.5 12.5"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <circle cx="12" cy="14" r="1.15" fill="currentColor" />

        {/* Right eyebrow & eye */}
        <path
          d="M 21.5 12.5 C 22.5 9.8 25.5 9.8 26.5 12.5"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <circle cx="24" cy="14" r="1.15" fill="currentColor" />

        {/* Nose: vertical line down with sharp right turn */}
        <path
          d="M 17 14 L 17 21 L 21 21"
          stroke="currentColor"
          strokeWidth="2.1"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Mouth: subtle arc */}
        <path
          d="M 15 25.5 C 16.5 26.8 19.5 26.8 21 25.5"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
}
