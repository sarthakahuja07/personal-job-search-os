import { Planned } from "@/components/planned";

export default function TemplatesPage() {
  return (
    <Planned
      title="Templates"
      tagline="Ask for a referral in two clicks, not ten minutes."
      purpose="Reusable outreach messages with {{variables}} filled from the job and contact you are looking at. The message is always editable before you send it — the aim is to remove the retyping, not to automate the asking."
      contents={[
        {
          heading: "Variables detected, not declared",
          detail: "A template is just text containing {{name}}, {{company}}, {{role}}, {{job_link}} and {{resume_link}}. Editing the wording never means touching a schema.",
        },
        {
          heading: "Filled from context",
          detail: "Opening a template from a job pre-fills the role, company and link; the resume link comes from Settings so it is never pasted wrong.",
        },
        {
          heading: "Preview, edit, copy",
          detail: "Including a WhatsApp deep link when the contact has a phone number, formatted to E.164 so it opens the right chat.",
        },
      ]}
      blockedBy="Waiting on the Applications board, since the natural place to reach a template is from a job you have just saved."
    />
  );
}
