import { Planned } from "@/components/planned";

export default function DsaPage() {
  return (
    <Planned
      title="DSA"
      tagline="A practice database that knows which companies ask what."
      purpose="The half of this product that turns a discovered job into an offer. Questions with topics, difficulty, frequency and the companies that ask them — so preparation can follow the interviews you are actually getting rather than a generic list."
      contents={[
        {
          heading: "Question database",
          detail: "Title, description, difficulty, tags, topics, companies, frequency, your notes and solution, and completion status.",
        },
        {
          heading: "Search and filter",
          detail: "By topic, difficulty, company or frequency — and by what you have not attempted, which is the filter that actually gets used.",
        },
        {
          heading: "Linked to the job board",
          detail: "An interview at NVIDIA should surface what NVIDIA asks. The companies table already exists, so this is a join rather than a new concept.",
        },
        {
          heading: "Imported from Notion",
          detail: "Your existing preparation content comes across rather than being retyped. The exact shape follows whatever your export looks like.",
        },
      ]}
      blockedBy="Phase 1 begins once Phase 0 is complete. The data model will be designed around your existing Notion content rather than guessed at first."
    />
  );
}
