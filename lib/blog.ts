import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { marked } from "marked";

export type Post = { slug: string; title: string; date: string; author: string; summary: string; html: string };

const DIR = join(process.cwd(), "content/blog");

function parse(file: string): Post {
  const raw = readFileSync(join(DIR, file), "utf8");
  const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error(`${file} has no front matter`);
  const meta: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    const i = line.indexOf(":");
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^"|"$/g, "");
  }
  return { slug: file.replace(/^\d{4}-\d{2}-\d{2}-/, "").replace(/\.md$/, ""), title: meta.title, date: meta.date, author: meta.author, summary: meta.summary, html: marked.parse(m[2], { async: false }) as string };
}

export function allPosts(): Post[] {
  return readdirSync(DIR).filter((f) => f.endsWith(".md")).map(parse).sort((a, b) => b.date.localeCompare(a.date));
}

export function postBySlug(slug: string): Post | undefined {
  return allPosts().find((p) => p.slug === slug);
}
