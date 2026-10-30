import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  ArrowRight,
  BookOpen,
  Check,
  Coins,
  Download,
  FileText,
  Globe2,
  Headphones,
  Layers,
  Mic,
  Palette,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Wand2,
} from "lucide-react";
import Header from "@/components/Header";
import { Footer } from "@/components/ui/Footer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CoverPreview } from "@/components/bookmaker/CoverPreview";
import { createBlankBook, LENGTH_OPTIONS } from "@/lib/bookmaker";

const fadeUp = {
  initial: { opacity: 0, y: 20 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true },
  transition: { duration: 0.5 },
};

const SAMPLE_BOOK = createBlankBook({
  title: "The Practical Guide to Digital Products",
  subtitle: "Turn what you already know into an offer people happily pay for",
  idea: "A practical guide for first-time creators who want to package their knowledge into a digital product.",
  audience: "creators",
  purpose: "lead_generation",
  length: "medium",
  status: "manuscript_ready",
  cover: {
    kind: "generated",
    design: {
      headline: "The Practical Guide to Digital Products",
      subheadline: "Turn what you already know into an offer people happily pay for",
      tagline: "Create · Package · Sell",
      motif: "orbit",
      style: "bold-editorial",
      palette: {
        background: "#241246",
        primary: "#f5f0ff",
        accent: "#f2b84b",
        text: "#ffffff",
      },
    },
  },
});

const benefits = [
  {
    icon: Mic,
    title: "Start with a voice note or text",
    description: "Describe your idea in your own words — type it or record it. Bookmaker turns it into a real book plan.",
  },
  {
    icon: FileText,
    title: "Outline comes first",
    description: "Get a title, subtitle and chapter-by-chapter outline. Edit every line until it sounds like you.",
  },
  {
    icon: Layers,
    title: "Useful visuals in every chapter",
    description: "Checklists, comparison tables, diagrams, charts and callouts that explain the idea — not decorative filler.",
  },
  {
    icon: Palette,
    title: "Designed for your book type",
    description: "Business, workbook, children's, memoir, devotional and more. Each gets a matching look and layout.",
  },
  {
    icon: Smartphone,
    title: "A PDF people can read on a phone",
    description: "Cover, title page, contents, clear headings and page numbers in a clean, print-ready A5 layout.",
  },
  {
    icon: Headphones,
    title: "An audiobook they can listen to",
    description: "Turn the finished manuscript into a narrated audiobook with a natural AI voice, chapter by chapter.",
  },
  {
    icon: ShieldCheck,
    title: "Credits you control",
    description: "See the exact cost before anything runs. Edits never use credits, and failed AI operations are refunded.",
  },
];

const steps = [
  { title: "Tell us your idea", description: "A sentence, a paragraph or a voice note. No blank-page panic." },
  { title: "Choose the reader and purpose", description: "Audience, goal, language and length — so the book fits its job." },
  { title: "Review your outline", description: "Edit the title, chapters and summaries until the structure is right." },
  { title: "Write, edit and design", description: "Generate the manuscript, refine chapters and add a cover when you are ready." },
  { title: "Export, publish or narrate", description: "Download a PDF, follow the publishing tutorials, or create a downloadable audiobook." },
];

const BookmakerLanding = () => {
  return (
    <div className="min-h-screen gradient-hero flex flex-col relative overflow-hidden">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-primary/5 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-accent/5 rounded-full blur-3xl" />
      </div>

      <Header />

      <main className="container mx-auto px-4 pt-20 pb-10 relative z-10 flex-1 sm:pt-24 sm:pb-12">
        <motion.section
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.65 }}
          className="mb-12 grid items-center gap-8 sm:mb-16 sm:gap-10 lg:mb-24 lg:grid-cols-[1.1fr_0.9fr]"
        >
          <div className="min-w-0 text-center lg:text-left">
            <Badge variant="outline" className="mb-4 gap-1">
              <BookOpen className="h-3 w-3 text-primary" /> BookMaker AI by Investours
            </Badge>
            <h1 className="mb-3 text-balance text-[1.75rem] font-bold leading-[1.12] text-foreground sm:mb-4 sm:text-4xl sm:leading-tight md:text-6xl">
              Turn Your Knowledge Into <span className="text-primary">Digital Income</span>
            </h1>
            <p className="mb-2 text-base font-medium text-primary sm:mb-3 sm:text-xl">
              Create your first ebook in minutes!
            </p>
            <p className="mx-auto mb-5 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:mb-6 sm:text-base lg:mx-0">
              You already know something worth sharing. Bookmaker AI helps you shape it into a
              professionally written, beautifully designed ebook — with an editable outline,
              chapters, useful visuals, a phone-ready PDF and an AI-narrated audiobook.
            </p>
            <div className="mb-5 flex flex-col flex-wrap items-stretch justify-center gap-3 sm:flex-row lg:justify-start">
              <Button asChild size="xl" variant="hero" className="w-full px-5 sm:w-auto sm:px-10">
                <Link to="/bookmaker/create">
                  Create My Ebook <ArrowRight className="ml-1.5 h-5 w-5" />
                </Link>
              </Button>
              <Button
                asChild
                size="xl"
                variant="outline"
                className="h-auto min-h-14 w-full whitespace-normal px-5 py-3 text-center text-base leading-snug sm:w-auto sm:px-10 sm:text-lg"
              >
                <Link to="/pricing?from=bookmaker">
                  Buy AI Credits<span className="hidden sm:inline">&nbsp;&amp; Create Your First Ebook</span>
                  <ArrowRight className="ml-1.5 hidden h-5 w-5 shrink-0 sm:inline-block" />
                </Link>
              </Button>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs text-muted-foreground sm:gap-x-5 sm:text-sm lg:justify-start">
              <span className="flex items-center gap-1.5">
                <Coins className="h-4 w-4 shrink-0 text-primary" /> AI credits from as low as ₦2,720
              </span>
              <span className="flex items-center gap-1.5">
                <Check className="h-4 w-4 shrink-0 text-green-600" /> Edit the outline before spending credits
              </span>
            </div>
          </div>

          <div className="relative mx-auto w-full max-w-sm pb-8 sm:pb-0 lg:max-w-md">
            <motion.div
              animate={{ y: [0, -10, 0] }}
              transition={{ repeat: Infinity, duration: 6, ease: "easeInOut" }}
              className="relative z-10 mx-auto w-[74%] rotate-[-3deg] sm:w-[78%]"
            >
              <CoverPreview book={SAMPLE_BOOK} authorName="Investours Creator" />
            </motion.div>
            <div className="absolute -bottom-4 left-0 z-20 w-[60%] max-w-[210px] rounded-2xl border border-border bg-card/95 p-3 shadow-xl backdrop-blur sm:-left-4 sm:bottom-0 sm:w-[62%] sm:p-4">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-primary">Outline preview</p>
              <p className="mt-1 text-xs font-semibold leading-snug sm:text-sm">8 chapters, mapped to your reader</p>
              <div className="mt-2 space-y-1.5 sm:mt-3">
                {[1, 2, 3].map((n) => (
                  <div key={n} className="flex items-center gap-2">
                    <span className="flex h-4 w-4 items-center justify-center rounded-full bg-primary/10 text-[9px] font-bold text-primary">
                      {n}
                    </span>
                    <span className="h-1.5 flex-1 rounded-full bg-muted" />
                  </div>
                ))}
              </div>
              <p className="mt-2 flex items-center gap-1 text-[10px] text-muted-foreground sm:mt-3 sm:text-[11px]">
                <Sparkles className="h-3 w-3 shrink-0 text-primary" /> Title + chapters in seconds
              </p>
            </div>
            <div className="absolute right-0 top-2 z-20 rounded-full border border-border bg-card px-2.5 py-1 text-[10px] font-medium shadow-md sm:-right-1 sm:top-4 sm:px-3 sm:py-1.5 sm:text-xs">
              PDF + audio
            </div>
          </div>
        </motion.section>

        <motion.section {...fadeUp} className="mb-12 sm:mb-16 lg:mb-24">
          <div className="mx-auto mb-6 max-w-2xl text-center sm:mb-8">
            <h2 className="mb-2 text-xl font-bold text-foreground sm:text-2xl">
              Everything you need to finish the book
            </h2>
            <p className="text-sm text-muted-foreground sm:text-base">
              Not a blank chat box. A guided publishing workflow from first idea to final PDF.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 sm:gap-5 lg:grid-cols-3">
            {benefits.map((benefit) => (
              <motion.div key={benefit.title} {...fadeUp}>
                <Card className="h-full border-border/60 bg-card/80 backdrop-blur hover:border-primary/30 transition-colors">
                  <CardContent className="p-4 sm:p-5">
                    <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <benefit.icon className="h-5 w-5" />
                    </div>
                    <h3 className="mb-1 font-semibold">{benefit.title}</h3>
                    <p className="text-sm leading-relaxed text-muted-foreground">{benefit.description}</p>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        </motion.section>

        <motion.section {...fadeUp} className="mb-12 sm:mb-16 lg:mb-24">
          <div className="mx-auto mb-6 max-w-2xl text-center sm:mb-8">
            <h2 className="mb-2 text-xl font-bold text-foreground sm:text-2xl">From idea to published PDF</h2>
            <p className="text-sm text-muted-foreground sm:text-base">One guided flow. You stay in control at every step.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-5">
            {steps.map((step, index) => (
              <div key={step.title} className="relative flex items-start gap-3 rounded-2xl border border-border/60 bg-card/70 p-4 sm:p-5 lg:block">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground lg:mb-3">
                  {index + 1}
                </span>
                <div className="min-w-0">
                  <h3 className="font-semibold leading-snug">{step.title}</h3>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{step.description}</p>
                </div>
              </div>
            ))}
          </div>
        </motion.section>

        <motion.section {...fadeUp} className="mb-12 sm:mb-16 lg:mb-24">
          <div className="mx-auto mb-6 max-w-2xl text-center sm:mb-8">
            <h2 className="mb-2 text-xl font-bold text-foreground sm:text-2xl">Choose your book size</h2>
            <p className="text-sm text-muted-foreground sm:text-base">
              Start with an outline on every size. Credits are only used when the AI writes.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-3 md:gap-5">
            {LENGTH_OPTIONS.map((option) => (
              <Card
                key={option.key}
                className={
                  option.key === "medium"
                    ? "relative border-2 border-primary bg-card shadow-lg"
                    : "border-border/60 bg-card/80"
                }
              >
                {option.key === "medium" ? (
                  <Badge className="absolute -top-3 left-1/2 -translate-x-1/2">Most popular</Badge>
                ) : null}
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-baseline justify-between gap-2">
                    <span>{option.label}</span>
                    <span className="text-sm font-medium text-primary">
                      {option.credits} credits
                    </span>
                  </CardTitle>
                  <p className="text-sm text-muted-foreground">{option.range}</p>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <p className="text-muted-foreground">{option.description}</p>
                  <ul className="space-y-2">
                    <li className="flex items-center gap-2">
                      <Check className="h-4 w-4 text-green-600" />
                      {option.chapters[0]}–{option.chapters[1]} chapters
                    </li>
                    <li className="flex items-center gap-2">
                      <Check className="h-4 w-4 text-green-600" />
                      Title and outline included
                    </li>
                    <li className="flex items-center gap-2">
                      <Check className="h-4 w-4 text-green-600" />
                      Editable manuscript + PDF export
                    </li>
                  </ul>
                  <Button asChild variant={option.key === "medium" ? "default" : "outline"} className="w-full">
                    <Link to="/bookmaker/create">Start with {option.label.toLowerCase()}</Link>
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
          <p className="mt-4 text-center text-xs text-muted-foreground">
            Chapter rewrite 1 credit · Visual rewrite 1 credit · Cover 1 credit · Audiobook 2 credits · Manual edits and PDF export are available.
          </p>
        </motion.section>

        <motion.section {...fadeUp} className="mb-12 sm:mb-16">
          <Card className="overflow-hidden border-primary/20 bg-gradient-to-br from-primary/5 via-card to-accent/5">
            <CardContent className="grid gap-5 p-5 sm:gap-6 sm:p-6 md:grid-cols-[1fr_auto] md:items-center md:p-8">
              <div className="min-w-0">
                <div className="mb-2 flex items-center gap-2 text-primary">
                  <Globe2 className="h-5 w-5 shrink-0" />
                  <span className="text-[11px] font-semibold uppercase tracking-wide sm:text-xs">Publishing tutorials included</span>
                </div>
                <h2 className="mb-2 text-xl font-bold sm:text-2xl">Finished the book? Learn how to sell it.</h2>
                <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
                  Follow our step-by-step publishing tutorials for platforms like Amazon KDP, Selar
                  and Gumroad — from uploading your PDF and setting a price to writing the book
                  description and launching to your audience.
                </p>
                <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1.5"><Download className="h-3.5 w-3.5 shrink-0" /> Print-ready PDF</span>
                  <span className="flex items-center gap-1.5"><Palette className="h-3.5 w-3.5 shrink-0" /> Cover included</span>
                  <span className="flex items-center gap-1.5"><Headphones className="h-3.5 w-3.5 shrink-0" /> Audiobook narration</span>
                  <span className="flex items-center gap-1.5"><Wand2 className="h-3.5 w-3.5 shrink-0" /> Rework anytime</span>
                </div>
              </div>
              <Button asChild size="lg" className="w-full md:w-auto">
                <Link to="/bookmaker/create">
                  Create your ebook <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            </CardContent>
          </Card>
        </motion.section>

        <motion.section {...fadeUp} className="text-center">
          <Card className="border-0 bg-gradient-to-r from-primary to-accent text-primary-foreground">
            <CardHeader className="p-5 sm:p-6">
              <CardTitle className="text-xl leading-snug sm:text-2xl md:text-3xl">Your first ebook is closer than you think.</CardTitle>
            </CardHeader>
            <CardContent className="p-5 pt-0 sm:p-6 sm:pt-0">
              <p className="mx-auto mb-5 max-w-xl text-sm text-primary-foreground/85">
                Start with a voice note or simple text. BookMaker AI takes over the writing and designing then you export your book.
              </p>
              <div className="mx-auto flex w-full max-w-xs flex-col justify-center gap-3 sm:max-w-none sm:flex-row">
                <Button asChild size="xl" className="h-auto min-h-14 w-full whitespace-normal bg-background px-5 py-3 leading-snug text-primary hover:bg-background/90 sm:w-auto sm:px-10">
                  <Link to="/bookmaker/create">
                    Create My Ebook <ArrowRight className="ml-2 h-5 w-5 shrink-0" />
                  </Link>
                </Button>
                <Button asChild size="xl" variant="outline" className="h-auto min-h-14 w-full whitespace-normal border-primary-foreground/40 bg-transparent px-5 py-3 leading-snug text-primary-foreground hover:bg-primary-foreground/10 sm:w-auto sm:px-10">
                  <Link to="/pricing?from=bookmaker">View credit packs</Link>
                </Button>
              </div>
              <p className="mt-3 text-xs text-primary-foreground/70">
                Buy AI Credits &amp; Create Your First Ebook → credits as low as ₦2,720
              </p>
            </CardContent>
          </Card>
        </motion.section>
      </main>

      <Footer />
    </div>
  );
};

export default BookmakerLanding;
