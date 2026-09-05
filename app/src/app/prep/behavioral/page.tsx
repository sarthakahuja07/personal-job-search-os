import { Planned } from "@/components/planned";

export default function BehavioralPage() {
  return (
    <Planned
      title="Behavioral"
      tagline="Your stories, written down once."
      purpose="The round most people improvise and then regret. A small set of real stories from your work — including the Uber years — captured properly, so the answer is recalled rather than invented in the room."
      contents={[
        {
          heading: "Story bank",
          detail: "Situation, what you actually did, the outcome, and what you would do differently — mapped to the themes interviewers keep returning to.",
        },
        {
          heading: "Company-specific preparation",
          detail: "Notes tied to a company, so the leadership-principle style questions can be prepared against the ones that use them.",
        },
        {
          heading: "Backend and language topics",
          detail: "Distributed systems, databases, Golang and Python — the rapid-fire questions that sit alongside the behavioral round.",
        },
      ]}
      blockedBy="Phase 1, after DSA and System Design."
    />
  );
}
