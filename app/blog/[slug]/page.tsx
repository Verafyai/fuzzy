import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { allPosts, postBySlug } from "@/lib/blog";

export function generateStaticParams() {
  return allPosts().map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const p = postBySlug((await params).slug);
  return p ? { title: `${p.title} | Fuzzy`, description: p.summary } : {};
}

export default async function PostPage({ params }: { params: Promise<{ slug: string }> }) {
  const p = postBySlug((await params).slug);
  if (!p) notFound();
  return (
    <main className="page" style={{ maxWidth: 760 }}>
      <article className="stack post" style={{ gap: 16 }}>
        <span className="mono muted" style={{ fontSize: 13 }}>{new Date(`${p.date}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })} · {p.author}</span>
        <h1 style={{ fontSize: "clamp(30px, 4.5vw, 42px)" }}>{p.title}</h1>
        <div className="post-body" dangerouslySetInnerHTML={{ __html: p.html }} />
      </article>
    </main>
  );
}
