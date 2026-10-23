import { PageHeader } from "@/components/ui/page-header";

export const metadata = { title: "Video" };

export default function VideoPage() {
  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Video"
        description="Turn a topic into a visual lesson that walks through the key ideas."
      />
      <section className="max-w-2xl rounded-xl border border-foreground/10 bg-surface p-6">
        <h2 className="font-semibold">Video generation is being built</h2>
        <p className="mt-2 text-sm leading-6 text-foreground/65">
          Provider integration and generation controls come next. This page
          does not currently create videos or make paid API requests.
        </p>
      </section>
    </div>
  );
}
