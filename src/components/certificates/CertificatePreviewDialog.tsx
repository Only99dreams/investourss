import investoursLogo from "@/assets/investours-logo.png";
import { Printer } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CertificatePreview } from "@/components/certificates/CertificatePreview";
import {
  CertificateDetails,
  CertificateTemplate,
  printCertificate,
  purposeLabel,
} from "@/lib/certificateTemplates";

interface CertificatePreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  template: CertificateTemplate | null;
  details: CertificateDetails;
  title?: string;
  printable?: boolean;
}

export function CertificatePreviewDialog({
  open,
  onOpenChange,
  template,
  details,
  title,
  printable = true,
}: CertificatePreviewDialogProps) {
  if (!template) return null;

  const handlePrint = () => {
    if (!printCertificate(template, details, investoursLogo)) {
      toast.error("Allow pop-ups to print or save this certificate");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>{title ?? template.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <CertificatePreview template={template} details={details} />
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="font-mono text-xs uppercase tracking-wide text-muted-foreground">
              {template.name} · {purposeLabel(template.purpose)}
            </p>
            {printable ? (
              <Button size="sm" onClick={handlePrint}>
                <Printer className="mr-2 h-4 w-4" />
                Print / save as PDF
              </Button>
            ) : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
