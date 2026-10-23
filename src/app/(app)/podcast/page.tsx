import { PageHeader } from "@/components/ui/page-header";

export const metadata = { title: "Podcast" };

export default function PodcastPage() {
  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Podcast"
        description="Turn a study topic into an audio lesson you can listen to."
      />
      <section className="max-w-2xl rounded-xl border border-foreground/10 bg-surface p-6">
        <h2 className="font-semibold">Podcast generation is being built</h2>
        <p className="mt-2 text-sm leading-6 text-foreground/65">
          Audio generation is not connected yet. This page does not currently
          generate audio or make paid API requests.
        </p>
      </section>
    </div>
  );
}
