import { PageHeader } from "@/components/ui/page-header";
import { requireUserId } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";

export const metadata = { title: "Profile" };

export default async function ProfilePage() {
  const userId = await requireUserId();
  const [user, profile] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { name: true, email: true, createdAt: true },
    }),
    prisma.studentProfile.findUnique({ where: { userId } }),
  ]);

  return (
    <div className="animate-fade-up max-w-xl">
      <PageHeader
        title="Profile"
        description="Your account details in Flux Labs."
      />
      <section className="space-y-4 rounded-xl border border-foreground/10 bg-surface p-6">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted">Name</p>
          <p className="mt-1 text-sm font-semibold">{user?.name ?? "—"}</p>
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted">Email</p>
          <p className="mt-1 text-sm font-semibold">{user?.email ?? "—"}</p>
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted">Display name</p>
          <p className="mt-1 text-sm font-semibold">{profile?.displayName ?? "—"}</p>
        </div>
      </section>
    </div>
  );
}
