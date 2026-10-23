import { PageHeader } from "@/components/ui/page-header";

export const metadata = { title: "History" };

export default function HistoryPage() {
  return (
    <div className="animate-fade-up">
      <PageHeader
        title="History"
        description="Find and revisit learning content you have created with Flux."
      />
      <section className="max-w-2xl rounded-xl border border-foreground/10 bg-surface p-6">
        <h2 className="font-semibold">Your history will appear here</h2>
        <p className="mt-2 text-sm leading-6 text-foreground/65">
          Saved generation history is not connected yet. Once generation
          workflows are implemented, completed items can be stored here.
        </p>
      </section>
    </div>
  );
}
