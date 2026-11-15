import investoursLogo from "@/assets/investours-logo.png";
import { CertificateTemplate, CertificateDetails, templateAccent } from "@/lib/certificateTemplates";
import { cn } from "@/lib/utils";

interface CertificatePreviewProps {
  template: CertificateTemplate;
  details: CertificateDetails;
  className?: string;
}

/**
 * On-screen rendering of a certificate template. Text scales with the card
 * width (container query units) so the same design reads well as a thumbnail
 * and as a full-width preview.
 */
export function CertificatePreview({ template, details, className }: CertificatePreviewProps) {
  const accent = templateAccent(template);
  const issued = details.issuedDate
    ? new Date(details.issuedDate).toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : new Date().toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      });
  const meta = [
    details.certificateNumber ? `Certificate No. ${details.certificateNumber}` : null,
    `Issued ${issued}`,
  ]
    .filter(Boolean)
    .join("  |  ");

  return (
    <div
      className={cn("relative w-full overflow-hidden rounded-lg bg-white shadow-sm", className)}
      style={{ containerType: "inline-size", aspectRatio: "1.414 / 1" }}
    >
      <div
        className="absolute inset-[3.2%] flex flex-col items-center px-[4cqw] pb-[2.2cqw] pt-[2.4cqw] text-center"
        style={{ border: `0.62cqw solid ${accent}`, color: "#1a1a2e" }}
      >
        <div
          className="pointer-events-none absolute inset-[1.3cqw]"
          style={{ border: `1px solid ${accent}`, opacity: 0.4 }}
        />

        <img
          src={investoursLogo}
          alt="Investours"
          className="object-contain"
          style={{ width: "17cqw", height: "5cqw" }}
        />
        <div
          className="uppercase text-[#8a8a94]"
          style={{ fontSize: "1.05cqw", letterSpacing: "0.15em", marginTop: "0.9cqw" }}
        >
          AI-Powered Platform Advancing Financial Intelligence
        </div>
        <div
          className="shrink-0"
          style={{ width: "46%", height: "1px", background: accent, margin: "1.3cqw 0 1.4cqw" }}
        />

        <div
          className="font-serif font-bold leading-tight"
          style={{ fontSize: "4.4cqw" }}
        >
          {template.heading}
        </div>
        <div
          className="shrink-0 rotate-45"
          style={{ width: "1.2cqw", height: "1.2cqw", background: accent, margin: "1.1cqw 0 1.3cqw" }}
        />

        <div className="font-serif text-[#5b5b66]" style={{ fontSize: "1.7cqw" }}>
          {template.intro_text || "This certifies that"}
        </div>
        <div className="font-serif font-bold" style={{ fontSize: "3.9cqw", margin: "1cqw 0" }}>
          {details.recipientName || "Member name"}
        </div>
        <div className="font-serif text-[#5b5b66]" style={{ fontSize: "1.55cqw" }}>
          {template.body_text || "has successfully completed the"}
        </div>
        <div
          className="font-serif font-bold"
          style={{ fontSize: "2.5cqw", color: accent, margin: "0.7cqw 0 1cqw" }}
        >
          {details.courseTitle || "Course title"}
        </div>
        <div className="font-sans text-[#8a8a94]" style={{ fontSize: "1.15cqw" }}>
          {meta}
        </div>

        <div className="mt-auto flex w-full items-end justify-between gap-[2cqw] pt-[1.4cqw]">
          <div
            className="max-w-[38%] text-left font-sans text-[#9a9aa4]"
            style={{ fontSize: "1.05cqw" }}
          >
            {template.footer_note || ""}
          </div>
          <div className="min-w-[24cqw] text-center">
            <div style={{ borderTop: "1px solid #4b4b55", marginBottom: "0.7cqw" }} />
            <div className="font-serif italic" style={{ fontSize: "2.1cqw" }}>
              {template.issuer_name || ""}
            </div>
            <div className="font-sans text-[#8a8a94]" style={{ fontSize: "1.05cqw" }}>
              {template.issuer_title || ""}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
