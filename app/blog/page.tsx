import type { Metadata } from "next";
import { allPosts } from "@/lib/blog";

export const metadata: Metadata = { title: "Blog | Fuzzy", description: "Notes on Fuzzy, fuzzing Solana programs, and Verafy Certification." };

export default function BlogIndex() {
  const posts = allPosts();
  return (
    <main className="page stack" style={{ gap: 28, maxWidth: 820 }}>
      <h1>Blog</h1>
      {posts.map((p) => (
        <article key={p.slug} className="panel stack" style={{ gap: 8 }}>
          <span className="mono muted" style={{ fontSize: 13 }}>{new Date(`${p.date}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })} · {p.author}</span>
          <h2><a href={`/blog/${p.slug}`} style={{ color: "var(--text)" }}>{p.title}</a></h2>
          <p className="quiet">{p.summary}</p>
        </article>
      ))}
    </main>
  );
}
