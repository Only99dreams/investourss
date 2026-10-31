import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  BookOpen,
  Coins,
  Download,
  Edit3,
  Headphones,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CoverPreview } from "@/components/bookmaker/CoverPreview";
import { BookmakerPurchaseDialog } from "@/components/bookmaker/BookmakerPurchaseDialog";
import {
  DEFAULT_ENTITLEMENT,
  type BookmakerBook,
  type BookmakerEntitlement,
  audienceLabel,
  bookWordCount,
  formatBookDate,
  lengthLabel,
  purposeLabel,
  statusLabel,
} from "@/lib/bookmaker";
import {
  consumeBookDownload,
  deleteBookmakerBook,
  getBookmakerEntitlement,
  listBookmakerBooks,
  resolveBookCoverUrl,
} from "@/lib/bookmakerApi";
import { openBookPrintPreview } from "@/lib/bookExport";

export function BookmakerHistorySection() {
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [books, setBooks] = useState<BookmakerBook[]>([]);
  const [entitlement, setEntitlement] = useState<BookmakerEntitlement>(DEFAULT_ENTITLEMENT);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [exportingId, setExportingId] = useState<string | null>(null);
  const [purchaseOpen, setPurchaseOpen] = useState(false);
  const [purchaseView, setPurchaseView] = useState<"packs" | "subscribe" | null>(null);

  const openPurchase = (view: "packs" | "subscribe" | null = null) => {
    setPurchaseView(view);
    setPurchaseOpen(true);
  };

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [nextBooks, nextEntitlement] = await Promise.all([
        listBookmakerBooks(),
        getBookmakerEntitlement(),
      ]);
      setBooks(nextBooks);
      setEntitlement(nextEntitlement);
    } catch (err) {
      toast({
        title: "Could not load your ebooks",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [user, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleDelete = async (book: BookmakerBook) => {
    if (!window.confirm(`Delete "${book.title || "Untitled book"}"? This cannot be undone.`)) return;
    setDeletingId(book.id);
    try {
      await deleteBookmakerBook(book.id);
      setBooks((current) => current.filter((item) => item.id !== book.id));
      toast({ title: "Ebook deleted" });
    } catch (err) {
      toast({
        title: "Could not delete the ebook",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setDeletingId(null);
    }
  };

  const handleExport = async (book: BookmakerBook) => {
    if (exportingId) return;
    // Open the window during the click; the credit check happens after.
    const targetWindow = window.open("", "_blank");
    if (!targetWindow) {
      toast({
        title: "Popup blocked",
        description: "Allow popups for Investours so the print-ready book can open.",
        variant: "destructive",
      });
      return;
    }
    if (!(book.chapters ?? []).length) {
      targetWindow.close();
      toast({
        title: "No manuscript yet",
        description: "Open the book and write the manuscript first.",
      });
      return;
    }
    setExportingId(book.id);
    try {
      const download = await consumeBookDownload(book.id);
      if (download.entitlement) setEntitlement(download.entitlement);
      if (!download.success) {
        targetWindow.close();
        toast({
          title: "Download unavailable",
          description:
            download.reason === "insufficient_credits"
              ? "Your free downloads for this book are used up. Buy credits or upgrade your plan to download again with 1 credit."
              : download.message || "Please try again.",
          variant: "destructive",
        });
        return;
      }
      const nextCount = download.download_count;
      if (typeof nextCount === "number") {
        setBooks((current) =>
          current.map((item) => (item.id === book.id ? { ...item, download_count: nextCount } : item)),
        );
      }
      const coverUrl = await resolveBookCoverUrl(book.cover);
      const opened = openBookPrintPreview(book, {
        authorName: book.outline?.author || undefined,
        coverUrl: coverUrl ?? undefined,
        targetWindow,
      });
      if (!opened) {
        targetWindow.close();
        toast({
          title: "Popup blocked",
          description: "Allow popups for Investours so the print-ready book can open.",
          variant: "destructive",
        });
        return;
      }
      toast({
        title: download.free ? "Download started" : "1 credit used",
        description: download.free
          ? "This download was included in your plan."
          : "Your free downloads for this book are used up, so 1 credit was applied.",
      });
    } catch (err) {
      targetWindow.close();
      toast({
        title: "Download failed",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setExportingId(null);
    }
  };

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-xl font-bold">My Ebooks</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Continue writing, redesign a cover, or export a finished book to PDF.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => navigate("/bookmaker")}>
            How it works
          </Button>
          <Button onClick={() => navigate("/bookmaker/create")} className="gap-2">
            <Plus className="h-4 w-4" /> New ebook
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Credits available</p>
            <p className="mt-1 flex items-center gap-2 text-2xl font-bold">
              <Coins className="h-5 w-5 text-primary" /> {entitlement.total_available}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {entitlement.subscription_credits_remaining} subscription · {entitlement.pack_credits_remaining} pack
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" onClick={() => openPurchase("packs")}>
                Buy credits
              </Button>
              <Button size="sm" variant="outline" onClick={() => openPurchase("subscribe")}>
                Subscribe
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Books started</p>
            <p className="mt-1 text-2xl font-bold">{books.length}</p>
            <p className="mt-1 text-xs text-muted-foreground">Every book is saved automatically.</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Words written</p>
            <p className="mt-1 text-2xl font-bold">
              {books.reduce((total, book) => total + bookWordCount(book), 0).toLocaleString("en-NG")}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">Across all your manuscripts.</p>
          </CardContent>
        </Card>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : books.length === 0 ? (
        <Card>
          <CardContent className="space-y-4 p-10 text-center">
            <BookOpen className="mx-auto h-12 w-12 text-muted-foreground/50" />
            <div>
              <h3 className="text-lg font-semibold">No ebooks yet</h3>
              <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                Turn your knowledge into a digital product.
              </p>
            </div>
            <Button onClick={() => navigate("/bookmaker/create")} size="lg" className="gap-2">
              <Sparkles className="h-4 w-4" /> Create your first ebook
            </Button>
            <p className="text-xs text-muted-foreground">AI credits from as low as ₦2,720.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {books.map((book, index) => {
            const chapters = book.chapters ?? [];
            const ready = chapters.length > 0;
            const downloadLimit = Math.max(0, Number(entitlement.download_limit ?? 0));
            const freeDownloadsLeft = Math.max(downloadLimit - (book.download_count ?? 0), 0);
            return (
              <motion.div
                key={book.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.04 }}
              >
                <Card className="overflow-hidden transition-colors hover:border-primary/30">
                  <CardContent className="p-4 sm:p-5">
                    <div className="flex flex-col gap-4 sm:flex-row">
                      <div className="mx-auto w-24 shrink-0 sm:mx-0">
                        <CoverPreview book={book} authorName={book.outline?.author || undefined} compact />
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="min-w-0 truncate font-semibold">{book.title || "Untitled book"}</h3>
                          <Badge variant="outline" className="text-[10px] capitalize">
                            {statusLabel(book.status)}
                          </Badge>
                          <Badge variant="secondary" className="text-[10px]">
                            {lengthLabel(book.length)}
                          </Badge>
                        </div>
                        {book.subtitle ? (
                          <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{book.subtitle}</p>
                        ) : null}
                        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                          <span>{chapters.length} chapters</span>
                          <span>{bookWordCount(book).toLocaleString("en-NG")} words</span>
                          <span>{book.credits_spent} credits used</span>
                          <span>
                            {downloadLimit === 0
                              ? "Downloads use 1 credit"
                              : freeDownloadsLeft > 0
                                ? `${freeDownloadsLeft} free download${freeDownloadsLeft === 1 ? "" : "s"} left`
                                : "1 credit per download"}
                          </span>
                          <span>Updated {formatBookDate(book.updated_at)}</span>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                          <span>For {audienceLabel(book)}</span>
                          <span>{purposeLabel(book)}</span>
                          <span>{book.language}</span>
                          {(book.audiobook?.chapters?.length ?? 0) > 0 ? (
                            <span className="inline-flex items-center gap-1 text-primary">
                              <Headphones className="h-3 w-3" /> Audiobook ready
                            </span>
                          ) : null}
                        </div>
                      </div>

                      <div className="flex shrink-0 flex-wrap items-start gap-2 sm:flex-col sm:items-stretch">
                        <Button size="sm" onClick={() => navigate(`/bookmaker/create?book=${book.id}`)} className="gap-1.5">
                          <Edit3 className="h-3.5 w-3.5" />
                          {ready ? "Continue" : "Open"}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void handleExport(book)}
                          disabled={!ready || exportingId === book.id}
                          className="gap-1.5"
                          title={ready ? "Open print-ready PDF" : "Write the manuscript first"}
                        >
                          {exportingId === book.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Download className="h-3.5 w-3.5" />
                          )}{" "}
                          PDF
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleDelete(book)}
                          disabled={deletingId === book.id}
                          className="gap-1.5 text-destructive hover:text-destructive"
                        >
                          {deletingId === book.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="h-3.5 w-3.5" />
                          )}
                          <span className="sm:hidden">Delete</span>
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            );
          })}
        </div>
      )}

      <Card className="border-dashed">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">How Bookmaker credits work</CardTitle>
          <CardDescription>
            Credit usage for writing, rewriting, cover design and narration. Manual edits use no credits, and each book includes free PDF downloads.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
          <p>Short book: 2 credits · Medium: 4 credits · Long: 6 credits</p>
          <p>Chapter rewrite: 1 credit · Visual refresh: 1 credit · Cover: 1 credit</p>
          <p>Audiobook narration: Short 4 · Medium 8 · Long 12 credits (platform credits only)</p>
          <p>Failed AI operations are refunded automatically.</p>
          <p>Free PDF downloads per ebook: Starter 3 · Standard 6 · Annual pack 12</p>
          <p>Free PDF downloads per ebook: Monthly 3 · Quarterly 6 · Bi-annual 12 · Annual 24</p>
          <p className="sm:col-span-2">
            After the free limit, each ebook download uses 1 credit. Playing the audiobook is always free.
          </p>
        </CardContent>
      </Card>

      <BookmakerPurchaseDialog
        open={purchaseOpen}
        onOpenChange={setPurchaseOpen}
        initialView={purchaseView ?? undefined}
        onPurchased={() => void load()}
      />
    </div>
  );
}

/** Bookmaker history section. */

export default BookmakerHistorySection;
