// Line icons for the capacity screens, drawn on a 256 grid with one stroke
// weight (16) and round ends, in the style of Phosphor's regular set.

type IconProps = { size?: number; title?: string };

function Svg({ size = 20, title, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 256 256" fill="none" stroke="currentColor" strokeWidth={16}
      strokeLinecap="round" strokeLinejoin="round" role={title ? "img" : undefined} aria-label={title}
      aria-hidden={title ? undefined : true} style={{ flex: "0 0 auto" }}
    >
      {children}
    </svg>
  );
}

export const IconArrowRight = (p: IconProps) => (
  <Svg {...p}><line x1="40" y1="128" x2="216" y2="128" /><polyline points="144 56 216 128 144 200" /></Svg>
);

export const IconCheck = (p: IconProps) => (
  <Svg {...p}><polyline points="40 144 96 200 224 72" /></Svg>
);

export const IconPhone = (p: IconProps) => (
  <Svg {...p}>
    <path d="M92.5 124.8a83.6 83.6 0 0 0 39 38.9 8 8 0 0 0 7.9-.6l25-16.7a8 8 0 0 1 7.6-.7l46.8 20.1a8 8 0 0 1 4.8 8.3A48 48 0 0 1 176 216 136 136 0 0 1 40 80a48 48 0 0 1 41.9-47.6 8 8 0 0 1 8.3 4.8l20.1 46.9a8 8 0 0 1-.6 7.5L93 117a8 8 0 0 0-.5 7.8Z" />
  </Svg>
);

export const IconChat = (p: IconProps) => (
  <Svg {...p}>
    <path d="M45.4 177A95.9 95.9 0 1 1 79 210.6L45.8 220a8 8 0 0 1-9.8-9.8Z" />
    <line x1="96" y1="112" x2="160" y2="112" />
    <line x1="96" y1="144" x2="144" y2="144" />
  </Svg>
);

export const IconEnvelope = (p: IconProps) => (
  <Svg {...p}>
    <rect x="32" y="56" width="192" height="144" rx="8" />
    <polyline points="224 56 128 144 32 56" />
  </Svg>
);

export const IconMapPin = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="128" cy="104" r="32" />
    <path d="M208 104c0 72-80 128-80 128S48 176 48 104a80 80 0 0 1 160 0Z" />
  </Svg>
);

export const IconInstagram = (p: IconProps) => (
  <Svg {...p}>
    <rect x="32" y="32" width="192" height="192" rx="48" />
    <circle cx="128" cy="128" r="40" />
    <circle cx="180" cy="76" r="6" fill="currentColor" stroke="none" />
  </Svg>
);

export const IconFacebook = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="128" cy="128" r="96" />
    <path d="M168 88h-16a24 24 0 0 0-24 24v112" />
    <line x1="96" y1="144" x2="160" y2="144" />
  </Svg>
);
