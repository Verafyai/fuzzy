/** A small info marker with a tooltip on hover and keyboard focus. */
export function Info({ text, label = "What this means" }: { text: string; label?: string }) {
  return (
    <span className="info" tabIndex={0} role="note" aria-label={`${label}: ${text}`}>
      <span aria-hidden="true">i</span>
      <span className="info-tip" role="tooltip">{text}</span>
    </span>
  );
}
