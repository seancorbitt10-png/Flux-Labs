import { PageHeader } from "@/components/ui/page-header";

export const metadata = { title: "Image" };

export default function ImagePage() {
  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Image"
        description="Create visual explanations and illustrations to help you study a topic."
      />
      <section className="max-w-2xl rounded-xl border border-foreground/10 bg-surface p-6">
        <h2 className="font-semibold">Image generation is being built</h2>
        <p className="mt-2 text-sm leading-6 text-foreground/65">
          The interface and generation workflow are not connected yet. No image
          generation request will be sent or charged from this page.
        </p>
      </section>
    </div>
  );
}
