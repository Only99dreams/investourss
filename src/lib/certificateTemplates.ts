export interface CertificateTemplate {
  id: string;
  name: string;
  purpose: string | null;
  heading: string;
  intro_text: string | null;
  body_text: string | null;
  footer_note: string | null;
  issuer_name: string | null;
  issuer_title: string | null;
  accent_color: string | null;
  is_published: boolean | null;
  is_default: boolean | null;
  order_index: number | null;
}

export interface CertificateDetails {
  recipientName: string;
  courseTitle: string;
  certificateNumber?: string | null;
  issuedDate?: string | null;
}

export const CERTIFICATE_PURPOSES = [
  { value: "completion", label: "Course completion" },
  { value: "achievement", label: "Achievement" },
  { value: "participation", label: "Participation" },
  { value: "excellence", label: "Excellence" },
  { value: "other", label: "Other purpose" },
] as const;

export const purposeLabel = (purpose: string | null | undefined): string =>
  CERTIFICATE_PURPOSES.find((option) => option.value === purpose)?.label ?? "Custom";

export const templateAccent = (template: CertificateTemplate | null | undefined): string => {
  const value = template?.accent_color?.trim();
  return value && /^#[0-9a-f]{3,8}$/i.test(value) ? value : "#7c3aed";
};

/** Used when the templates table is unavailable (migration not applied yet). */
export const DEFAULT_CERTIFICATE_TEMPLATES: CertificateTemplate[] = [
  {
    id: "default-completion",
    name: "Certificate of Completion",
    purpose: "completion",
    heading: "Certificate of Completion",
    intro_text: "This certifies that",
    body_text: "has successfully completed the",
    footer_note: "Investours Education & Mentorship",
    issuer_name: "Olusegun Emmanuel",
    issuer_title: "Founder & CEO, Investours",
    accent_color: "#7c3aed",
    is_published: true,
    is_default: true,
    order_index: 1,
  },
  {
    id: "default-achievement",
    name: "Certificate of Achievement",
    purpose: "achievement",
    heading: "Certificate of Achievement",
    intro_text: "This certificate is proudly presented to",
    body_text: "in recognition of outstanding achievement in",
    footer_note: "Investours Education & Mentorship",
    issuer_name: "Olusegun Emmanuel",
    issuer_title: "Founder & CEO, Investours",
    accent_color: "#059669",
    is_published: true,
    is_default: false,
    order_index: 2,
  },
  {
    id: "default-participation",
    name: "Certificate of Participation",
    purpose: "participation",
    heading: "Certificate of Participation",
    intro_text: "This is to certify that",
    body_text: "participated in and completed the training programme",
    footer_note: "Investours Education & Mentorship",
    issuer_name: "Olusegun Emmanuel",
    issuer_title: "Founder & CEO, Investours",
    accent_color: "#2563eb",
    is_published: true,
    is_default: false,
    order_index: 3,
  },
  {
    id: "default-excellence",
    name: "Certificate of Excellence",
    purpose: "excellence",
    heading: "Certificate of Excellence",
    intro_text: "Awarded to",
    body_text: "for exceptional performance and dedication in",
    footer_note: "Investours Education & Mentorship",
    issuer_name: "Olusegun Emmanuel",
    issuer_title: "Founder & CEO, Investours",
    accent_color: "#d97706",
    is_published: true,
    is_default: false,
    order_index: 4,
  },
];

export const resolveTemplate = (
  templates: CertificateTemplate[],
  templateId: string | null | undefined,
): CertificateTemplate => {
  const match = templateId ? templates.find((template) => template.id === templateId) : undefined;
  return (
    match ??
    templates.find((template) => template.is_default) ??
    templates[0] ??
    DEFAULT_CERTIFICATE_TEMPLATES[0]
  );
};

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/**
 * Opens a print-ready window with the certificate. Printing to PDF is the
 * download path, mirroring how book exports are produced.
 */
export const printCertificate = (
  template: CertificateTemplate,
  details: CertificateDetails,
  logoUrl?: string,
): boolean => {
  const win = window.open("", "_blank", "width=1100,height=820");
  if (!win) return false;

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
    .join("   |   ");

  win.document.write(`<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${escapeHtml(template.name)} - ${escapeHtml(details.recipientName)}</title>
<style>
  @page { size: A4 landscape; margin: 0; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: Georgia, 'Times New Roman', serif;
    background: #f1f1f4;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
  }
  .sheet {
    position: relative;
    width: 1000px;
    height: 707px;
    background: #ffffff;
    padding: 34px;
    color: #1a1a2e;
  }
  .frame {
    position: relative;
    height: 100%;
    border: 8px solid ${accent};
    padding: 26px 40px 20px;
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
  }
  .inner {
    position: absolute;
    inset: 14px;
    border: 1.5px solid ${accent}66;
    pointer-events: none;
  }
  .logo { width: 170px; margin-top: 4px; }
  .brand {
    font-family: Arial, sans-serif;
    font-size: 11px;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: #8a8a94;
    margin-top: 10px;
  }
  .rule {
    width: 46%;
    height: 1px;
    background: ${accent};
    opacity: 0.55;
    margin: 12px 0 16px;
  }
  h1 {
    font-size: 46px;
    letter-spacing: 0.01em;
    font-weight: 700;
    margin: 0 0 6px;
  }
  .diamond {
    width: 12px;
    height: 12px;
    background: ${accent};
    transform: rotate(45deg);
    margin: 6px 0 18px;
  }
  .intro { font-size: 18px; color: #5b5b66; margin: 0; }
  .recipient { font-size: 40px; font-weight: 700; margin: 14px 0 10px; }
  .body { font-size: 16px; color: #5b5b66; margin: 0 0 8px; }
  .course { font-size: 26px; font-weight: 700; color: ${accent}; margin: 0 0 18px; }
  .meta { font-family: Arial, sans-serif; font-size: 12px; color: #8a8a94; margin-bottom: 8px; }
  .footer {
    margin-top: auto;
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    width: 100%;
    gap: 24px;
    padding-top: 14px;
  }
  .note { font-family: Arial, sans-serif; font-size: 11px; color: #9a9aa4; max-width: 40%; text-align: left; }
  .sign { min-width: 240px; text-align: center; }
  .sign .line { border-top: 1px solid #4b4b55; margin-bottom: 8px; }
  .sign .name { font-style: italic; font-size: 22px; }
  .sign .role { font-family: Arial, sans-serif; font-size: 11px; color: #8a8a94; margin-top: 3px; }
  @media print {
    body { background: #ffffff; }
    .sheet { box-shadow: none; }
  }
</style>
</head>
<body>
  <div class="sheet">
    <div class="frame">
      <div class="inner"></div>
      ${logoUrl ? `<img class="logo" src="${escapeHtml(logoUrl)}" alt="Investours" />` : `<div style="font-size:22px;font-weight:700;letter-spacing:0.12em;color:${accent}">INVESTOURS</div>`}
      <div class="brand">AI-Powered Platform Advancing Financial Intelligence</div>
      <div class="rule"></div>
      <h1>${escapeHtml(template.heading)}</h1>
      <div class="diamond"></div>
      <p class="intro">${escapeHtml(template.intro_text || "This certifies that")}</p>
      <div class="recipient">${escapeHtml(details.recipientName)}</div>
      <p class="body">${escapeHtml(template.body_text || "has successfully completed the")}</p>
      <div class="course">${escapeHtml(details.courseTitle)}</div>
      <div class="meta">${escapeHtml(meta)}</div>
      <div class="footer">
        <div class="note">${escapeHtml(template.footer_note || "")}</div>
        <div class="sign">
          <div class="line"></div>
          <div class="name">${escapeHtml(template.issuer_name || "")}</div>
          <div class="role">${escapeHtml(template.issuer_title || "")}</div>
        </div>
      </div>
    </div>
  </div>
  <script>
    window.onload = function () {
      setTimeout(function () { window.print(); }, 250);
    };
  </script>
</body>
</html>`);
  win.document.close();
  return true;
};
