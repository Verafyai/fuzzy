/** One sub-menu for everything under Docs, so the header carries only Registry and Docs. */
const ITEMS = [
  ["/docs#mcp", "MCP server"],
  ["/docs#api", "HTTP API"],
  ["/docs/method", "Method"],
];

export function DocsNav({ current }: { current: string }) {
  return (
    <nav className="seg" aria-label="Docs" style={{ alignSelf: "flex-start" }}>
      {ITEMS.map(([href, label]) => (
        <a key={href} href={href} aria-current={current === href ? "page" : undefined}>{label}</a>
      ))}
    </nav>
  );
}
