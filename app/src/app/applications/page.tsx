import { Planned } from "@/components/planned";

export default function ApplicationsPage() {
  return (
    <Planned
      title="Applications"
      tagline="Track a role from saved through to interviews."
      purpose="A Kanban board with exactly five stages — Saved, Requested, Referred, Applied, Interviews. Deliberately no Recruiter Screen, Onsite or Offer columns: extra stages make a board look thorough and feel like admin, and the point is to know what needs a nudge today."
      contents={[
        {
          heading: "Five columns, drag between them",
          detail: "Moving a card records the timestamp for that stage, which is what makes follow-up reminders possible.",
        },
        {
          heading: "Referral follow-ups",
          detail: "A role sitting in Requested past your threshold surfaces on the dashboard with the contact to chase — the reason requested_at is already stored.",
        },
        {
          heading: "One card per job",
          detail: "The database already enforces this: a job can have at most one application, so the board can never disagree with itself.",
        },
      ]}
      blockedBy="The schema and the follow-up threshold setting are already in place; this is the next feature after the crawler's conformance suite."
    />
  );
}
