import { Planned } from "@/components/planned";

export default function SystemDesignPage() {
  return (
    <Planned
      title="System Design"
      tagline="Worked designs, not a reading list."
      purpose="System design is the discriminator at SDE-2 and above. This section holds the questions, the requirements you would gather, the architecture you would propose, and the trade-offs you would defend — written in your own words, because that is the only version you can recall under pressure."
      contents={[
        {
          heading: "Question bank",
          detail: "With topics, and the companies known to ask each one.",
        },
        {
          heading: "Requirements, architecture, trade-offs",
          detail: "Kept as separate fields rather than one blob, because an interview walks through them in that order.",
        },
        {
          heading: "References and completion tracking",
          detail: "Links to the sources that actually helped, plus what you have genuinely finished versus skimmed.",
        },
      ]}
      blockedBy="Phase 1. Shape to be finalised alongside the DSA section once your Notion content is available."
    />
  );
}
