/**
 * Fuzzy, the mascot. Same drawing as brand/fuzzy-*.svg. The mood follows the
 * run and the grade: waiting, sniffing, found, hardened, broken.
 */
export type Mood = "waiting" | "sniffing" | "found" | "hardened" | "broken";

const FUR = "#4FD1B5";
const SHADE = "#2BA88E";
const BELLY = "#9BEBD8";
const FEET = "#238C76";
const TIP = "#F5B84B";
const INK = "#0B0D10";

export function FuzzyMascot({
  mood = "waiting",
  size = 120,
  className,
  decorative = false,
}: {
  mood?: Mood;
  size?: number;
  className?: string;
  decorative?: boolean;
}) {
  const label = {
    waiting: "Fuzzy, waiting",
    sniffing: "Fuzzy, sniffing with a magnifying glass",
    found: "Fuzzy, alarmed, holding up a caught bug",
    hardened: "Fuzzy, happy, with a shield",
    broken: "Fuzzy, dizzy with spiral eyes",
  }[mood];
  const spiky = mood === "found";
  return (
    <svg
      viewBox="0 0 200 200"
      width={size}
      height={size}
      className={className}
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : label}
      aria-hidden={decorative ? true : undefined}
    >
      <Antennae mood={mood} />
      <circle cx="100" cy="112" r="64" fill={SHADE} stroke={SHADE} strokeWidth={spiky ? 26 : 20} strokeLinecap="round" strokeDasharray={spiky ? "0.01 16.75" : "0.01 25.13"} />
      <circle cx="100" cy="112" r="60" fill={FUR} stroke={FUR} strokeWidth="16" strokeLinecap="round" strokeDasharray={spiky ? "0.01 15.7" : "0.01 23.56"} strokeDashoffset={spiky ? 7.85 : 11.8} />
      <circle cx="100" cy="44" r="10" fill={FUR} />
      <circle cx="88" cy="50" r="8" fill={FUR} />
      <circle cx="112" cy="50" r="8" fill={FUR} />
      <ellipse cx="100" cy="140" rx="34" ry="26" fill={BELLY} />
      <ellipse cx="80" cy="178" rx="15" ry="8" fill={FEET} />
      <ellipse cx="120" cy="178" rx="15" ry="8" fill={FEET} />
      {mood !== "found" && mood !== "broken" ? (
        <>
          <ellipse cx="60" cy="123" rx="9" ry="5" fill="#FF8FA3" opacity="0.7" />
          <ellipse cx="140" cy="123" rx="9" ry="5" fill="#FF8FA3" opacity="0.7" />
        </>
      ) : null}
      <Face mood={mood} />
    </svg>
  );
}

function Antennae({ mood }: { mood: Mood }) {
  const paths: Record<Mood, [string, string, [number, number], [number, number]]> = {
    waiting: ["M82 56 Q74 36 66 22", "M118 56 Q126 36 134 22", [66, 20], [134, 20]],
    hardened: ["M82 56 Q74 36 66 22", "M118 56 Q126 36 134 22", [66, 20], [134, 20]],
    sniffing: ["M84 56 Q82 34 78 16", "M116 56 Q118 34 122 16", [78, 14], [122, 14]],
    found: ["M84 56 L80 14", "M116 56 L120 14", [80, 12], [120, 12]],
    broken: ["M82 56 Q66 50 58 62", "M118 56 Q134 50 142 62", [57, 65], [143, 65]],
  };
  const [a, b, ta, tb] = paths[mood];
  return (
    <>
      <path d={a} stroke={SHADE} strokeWidth="4" fill="none" strokeLinecap="round" />
      <path d={b} stroke={SHADE} strokeWidth="4" fill="none" strokeLinecap="round" />
      <circle cx={ta[0]} cy={ta[1]} r="6" fill={TIP} />
      <circle cx={tb[0]} cy={tb[1]} r="6" fill={TIP} />
    </>
  );
}

function Face({ mood }: { mood: Mood }) {
  if (mood === "hardened") {
    return (
      <>
        <path d="M66 104 Q78 92 90 104" stroke={INK} strokeWidth="4" fill="none" strokeLinecap="round" />
        <path d="M110 104 Q122 92 134 104" stroke={INK} strokeWidth="4" fill="none" strokeLinecap="round" />
        <path d="M88 122 Q100 138 112 122" stroke={INK} strokeWidth="3.5" fill="none" strokeLinecap="round" />
        <path d="M156 118 L176 126 L176 142 Q176 156 156 166 Q136 156 136 142 L136 126 Z" fill={TIP} stroke={INK} strokeWidth="2" />
        <path d="M146 142 L154 150 L167 134" stroke={INK} strokeWidth="4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </>
    );
  }
  if (mood === "broken") {
    return (
      <>
        <circle cx="78" cy="102" r="16" fill="#FFFFFF" />
        <circle cx="122" cy="102" r="16" fill="#FFFFFF" />
        <path d="M67 102 a11 11 0 1 1 22 0 a8 8 0 1 1 -16 0 a5 5 0 1 1 10 0" stroke={INK} strokeWidth="2.5" fill="none" strokeLinecap="round" />
        <path d="M111 102 a11 11 0 1 1 22 0 a8 8 0 1 1 -16 0 a5 5 0 1 1 10 0" stroke={INK} strokeWidth="2.5" fill="none" strokeLinecap="round" />
        <path d="M88 130 Q94 124 100 130 Q106 136 112 130" stroke={INK} strokeWidth="3" fill="none" strokeLinecap="round" />
        <circle cx="48" cy="40" r="3.5" fill={TIP} />
        <circle cx="156" cy="34" r="3.5" fill={TIP} />
        <circle cx="168" cy="80" r="3" fill={TIP} />
      </>
    );
  }
  if (mood === "found") {
    return (
      <>
        <circle cx="76" cy="100" r="19" fill="#FFFFFF" />
        <circle cx="124" cy="100" r="19" fill="#FFFFFF" />
        <circle cx="76" cy="100" r="6" fill={INK} />
        <circle cx="124" cy="100" r="6" fill={INK} />
        <ellipse cx="100" cy="131" rx="6" ry="7" fill={INK} />
        <path d="M153 50 L143 42 M171 50 L181 42 M152 58 L142 60 M172 58 L182 60" stroke="#FF5A5F" strokeWidth="2.5" strokeLinecap="round" />
        <ellipse cx="162" cy="54" rx="11" ry="8" fill="#FF5A5F" />
        <circle cx="158" cy="52" r="2" fill={INK} />
        <circle cx="166" cy="52" r="2" fill={INK} />
        <path d="M40 40 L40 58" stroke={TIP} strokeWidth="5" strokeLinecap="round" />
        <circle cx="40" cy="68" r="3" fill={TIP} />
      </>
    );
  }
  const look = mood === "sniffing" ? 5 : 2;
  return (
    <>
      <circle cx="78" cy="102" r="16" fill="#FFFFFF" />
      <circle cx="122" cy="102" r="16" fill="#FFFFFF" />
      <circle cx={78 + look} cy={102 + look} r="9" fill={INK} />
      <circle cx={122 + look} cy={102 + look} r="9" fill={INK} />
      <circle cx={82 + look} cy={97 + look} r="3.5" fill="#FFFFFF" />
      <circle cx={126 + look} cy={97 + look} r="3.5" fill="#FFFFFF" />
      {mood === "sniffing" ? (
        <>
          <path d="M95 128 L105 128" stroke={INK} strokeWidth="3" fill="none" strokeLinecap="round" />
          <circle cx="152" cy="138" r="18" fill="#FFFFFF" fillOpacity="0.22" stroke="#E8EAED" strokeWidth="6" />
          <path d="M165 151 L184 170" stroke="#E8EAED" strokeWidth="8" strokeLinecap="round" />
        </>
      ) : (
        <path d="M93 126 Q100 133 107 126" stroke={INK} strokeWidth="3" fill="none" strokeLinecap="round" />
      )}
    </>
  );
}

export function moodForGrade(grade: string): Mood {
  if (grade === "Hardened") return "hardened";
  if (grade === "Broken") return "broken";
  if (grade === "Exposed") return "found";
  return "waiting";
}
