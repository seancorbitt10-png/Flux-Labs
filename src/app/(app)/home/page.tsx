import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { requireUserId } from "@/lib/auth/session";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";

export const metadata = { title: "Home" };

const tools = [
  {
    href: "/image",
    title: "Image",
    description: "Create visual explanations and study illustrations.",
  },
  {
    href: "/podcast",
    title: "Podcast",
    description: "Turn a topic into an audio lesson you can listen to.",
  },
  {
    href: "/history",
    title: "History",
    description: "Return to the learning content you have created.",
  },
];

export default async function HomePage() {
  const userId = await requireUserId();
  const [profile, session] = await Promise.all([
    prisma.studentProfile.findUnique({ where: { userId } }),
    auth(),
  ]);

  const firstName =
    profile?.displayName?.split(" ")[0] ??
    session?.user?.name?.split(" ")[0] ??
    "there";

  return (
    <div className="animate-fade-up">
      <PageHeader
        title={`Welcome, ${firstName}`}
        description="A focused workspace for turning school topics into useful learning content."
      />

      <section className="relative overflow-hidden rounded-2xl border border-foreground/10 bg-surface p-6 sm:p-9">
        <div className="pointer-events-none absolute inset-0 bg-atmosphere opacity-60" />
        <div className="relative max-w-2xl">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-accent">
            Featured tool
          </p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
            Turn Any Topic Into a Video Lesson
          </h2>
          <p className="mt-3 max-w-xl text-sm leading-6 text-foreground/65 sm:text-base">
            Start with a topic and build a visual lesson designed to make it
            easier to understand. Video generation is not available yet.
          </p>
          <Link
            href="/video"
            className="mt-6 inline-flex min-h-11 items-center rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
          >
            Explore video generation
          </Link>
        </div>
      </section>

      <section className="mt-9">
        <div className="mb-4">
          <h2 className="text-lg font-semibold">More ways to learn</h2>
          <p className="mt-1 text-sm text-muted">
            Your tools, without the clutter.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {tools.map((tool) => (
            <Link
              key={tool.href}
              href={tool.href}
              className="group rounded-xl border border-foreground/10 bg-surface/70 p-5 transition-colors hover:border-accent/40 hover:bg-surface"
            >
              <h3 className="font-semibold group-hover:text-accent">
                {tool.title}
              </h3>
              <p className="mt-2 text-sm leading-6 text-foreground/60">
                {tool.description}
              </p>
              <span className="mt-4 inline-block text-sm font-semibold text-accent">
                Open tool →
              </span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
