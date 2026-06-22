import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  FileText, ArrowLeft, Loader2, Sparkles, Building2,
  Lightbulb, Wallet, AlertCircle, Edit3, RefreshCw, TrendingUp,
  Download, Crown, CheckCircle, X, Shrink, Expand,
  LayoutList, Book, Target, Lock, Trash2, Save
} from "lucide-react";
import { useNavigate, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import Header from "@/components/Header";
import { Footer } from "@/components/ui/Footer";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { downloadDOCX, downloadPDF } from "@/lib/planExport";

interface BusinessPlanForm {
  founderName: string;
  businessName: string;
  country: string;
  state: string;
  businessIdea: string;
  industry: string;
  businessStage: string;
  problem: string;
  solution: string;
  targetCustomers: string;
  revenueModel: string;
  startupBudget: string;
  pricingStrategy: string;
  currentTraction: string;
  fundingGoal: string;
  fundingSource: string;
}

type VersionType = 'standard' | 'grant' | 'investor' | 'loan' | 'accelerator';

const SECTIONS = [
  'Executive Summary',
  'Problem Statement',
  'Solution',
  'Market Opportunity',
  'Competitive Analysis',
  'Business Model',
  'Marketing & Sales Strategy',
  'Operations Plan',
  'Financial Projections',
  'Risk Analysis',
  'Funding Readiness Assessment',
  'Action Plan',
];

const initialForm: BusinessPlanForm = {
  founderName: "",
  businessName: "",
  country: "",
  state: "",
  businessIdea: "",
  industry: "",
  businessStage: "",
  problem: "",
  solution: "",
  targetCustomers: "",
  revenueModel: "",
  startupBudget: "",
  pricingStrategy: "",
  currentTraction: "",
  fundingGoal: "",
  fundingSource: "",
};

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const BusinessPlanGenerator = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { profile, user } = useAuth();
  const { toast } = useToast();
  const isPremium = profile?.user_tier === 'premium' || profile?.user_tier === 'exclusive';

  const [form, setForm] = useState<BusinessPlanForm>(initialForm);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedPlan, setGeneratedPlan] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeVersion, setActiveVersion] = useState<VersionType>('standard');
  const [revisionCount, setRevisionCount] = useState(0);
  const [editingSection, setEditingSection] = useState<number | null>(null);
  const [editContent, setEditContent] = useState('');
  const [improveInput, setImproveInput] = useState<{ section: number; prompt: string } | null>(null);
  const [regeneratingSection, setRegeneratingSection] = useState<number | null>(null);
  const [isAdjustingLength, setIsAdjustingLength] = useState(false);
  const [savePlanId, setSavePlanId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const trackedEvents = useRef<Set<string>>(new Set());

  const trackEvent = useCallback((eventType: string, metadata: Record<string, unknown> = {}) => {
    if (trackedEvents.current.has(eventType)) return;
    trackedEvents.current.add(eventType);
    supabase.from("business_plan_analytics").insert({
      user_id: user?.id,
      event_type: eventType,
      metadata,
    }).then(({ error }) => {
      if (error) console.error("Analytics error:", error);
    });
  }, [user?.id]);

  // Track tool open once per session
  useEffect(() => {
    trackEvent("opened_tool");
  }, [trackEvent]);

  // Load a saved plan from dashboard navigation
  useEffect(() => {
    const savedPlan = (location.state as any)?.savedPlan;
    if (savedPlan) {
      if (savedPlan.form_data) setForm(savedPlan.form_data);
      if (savedPlan.plan_content) setGeneratedPlan(savedPlan.plan_content);
      if (savedPlan.version) setActiveVersion(savedPlan.version);
      if (savedPlan.id) setSavePlanId(savedPlan.id);
      window.history.replaceState({}, document.title);
    }
  }, []);

  const updateField = (field: keyof BusinessPlanForm, value: string) => {
    setForm(prev => {
      if (!trackedEvents.current.has("started_form") && value) {
        trackEvent("started_form");
      }
      return { ...prev, [field]: value };
    });
  };

  const canRevise = isPremium || revisionCount < 1;

  const invokePlan = useCallback(async (payload: Record<string, unknown>) => {
    setIsGenerating(true);
    setError(null);
    try {
      const { data, error } = await supabase.functions.invoke('business-plan', { body: payload });
      if (error) throw error;
      if (data.error) throw new Error(data.error);
      return data.response as string;
    } catch (err: any) {
      const msg = err.message || "Failed to generate business plan";
      setError(msg);
      toast({ title: "Error", description: msg, variant: "destructive" });
      return null;
    } finally {
      setIsGenerating(false);
    }
  }, [toast]);

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.country || !form.businessIdea || !form.industry || !form.businessStage) {
      toast({
        title: "Missing required fields",
        description: "Please fill in all required fields (Country, Business Idea, Industry, Business Stage).",
        variant: "destructive",
      });
      return;
    }
    const plan = await invokePlan({ action: 'generate', formData: form, version: activeVersion });
    if (plan) {
      setGeneratedPlan(plan);
      setRevisionCount(0);
      trackEvent("generated_plan", { version: activeVersion });
    }
  };

  const handleSwitchVersion = async (version: VersionType) => {
    if (!canRevise) {
      toast({ title: "Revision Limit Reached", description: "Upgrade to Premium for unlimited revisions.", variant: "destructive" });
      return;
    }
    setActiveVersion(version);
    setRevisionCount(prev => prev + 1);
    const plan = await invokePlan({ action: 'switch_version', formData: form, version });
    if (plan) setGeneratedPlan(plan);
    else setRevisionCount(prev => Math.max(0, prev - 1));
  };

  const handleRegenerateSection = async (section: number) => {
    if (!canRevise) {
      toast({ title: "Revision Limit Reached", description: "Upgrade to Premium for unlimited revisions.", variant: "destructive" });
      return;
    }
    setRegeneratingSection(section);
    setRevisionCount(prev => prev + 1);
    const plan = await invokePlan({
      action: 'regenerate_section',
      formData: form,
      currentPlan: generatedPlan,
      sectionNumber: section,
    });
    if (plan) {
      setGeneratedPlan(plan);
      setImproveInput(null);
    } else {
      setRevisionCount(prev => Math.max(0, prev - 1));
    }
    setRegeneratingSection(null);
  };

  const handleImproveSection = async () => {
    if (!improveInput || !improveInput.prompt.trim()) return;
    if (!canRevise) {
      toast({ title: "Revision Limit Reached", description: "Upgrade to Premium for unlimited revisions.", variant: "destructive" });
      return;
    }
    setRevisionCount(prev => prev + 1);
    const plan = await invokePlan({
      action: 'improve_section',
      formData: form,
      currentPlan: generatedPlan,
      sectionNumber: improveInput.section,
      improveInstruction: improveInput.prompt,
    });
    if (plan) {
      setGeneratedPlan(plan);
      setImproveInput(null);
    } else {
      setRevisionCount(prev => Math.max(0, prev - 1));
    }
  };

  const handleAdjustLength = async (direction: 'shorter' | 'longer') => {
    if (!canRevise) {
      toast({ title: "Revision Limit Reached", description: "Upgrade to Premium for unlimited revisions.", variant: "destructive" });
      return;
    }
    setIsAdjustingLength(true);
    setRevisionCount(prev => prev + 1);
    const plan = await invokePlan({
      action: 'adjust_length',
      formData: form,
      currentPlan: generatedPlan,
      lengthDirection: direction,
    });
    if (plan) {
      setGeneratedPlan(plan);
    } else {
      setRevisionCount(prev => Math.max(0, prev - 1));
    }
    setIsAdjustingLength(false);
  };

  const handleSavePlan = async () => {
    if (!generatedPlan || !user) return;
    if (!isPremium) {
      const { count } = await supabase
        .from("business_plans")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id);
      if (count && count >= 3) {
        toast({ title: "Save Limit Reached", description: "Free users can save up to 3 plans. Upgrade to Premium for unlimited saves.", variant: "destructive" });
        return;
      }
    }
    setIsSaving(true);
    try {
      const planName = form.businessName?.trim() || form.businessIdea?.trim().slice(0, 60) || "Untitled Plan";
      if (savePlanId) {
        const { error } = await supabase
          .from("business_plans")
          .update({ name: planName, form_data: form, plan_content: generatedPlan, version: activeVersion, updated_at: new Date().toISOString() })
          .eq("id", savePlanId);
        if (error) throw error;
        toast({ title: "Plan Updated", description: "Your changes have been saved." });
      } else {
        const { data, error } = await supabase
          .from("business_plans")
          .insert({ user_id: user.id, name: planName, form_data: form, plan_content: generatedPlan, version: activeVersion })
          .select("id")
          .single();
        if (error) throw error;
        setSavePlanId(data.id);
        toast({ title: "Plan Saved!", description: "Your business plan has been saved." });
      }
    } catch (err: any) {
      toast({ title: "Error", description: err.message || "Failed to save plan", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteSection = (section: number) => {
    if (!generatedPlan) return;
    const sectionHeader = SECTIONS[section - 1];
    if (!window.confirm(`Delete "${sectionHeader}"? This cannot be undone.`)) return;
    const pattern = new RegExp(`##\\s+${section}\\.\\s+${escapeRegExp(sectionHeader)}[\\s\\S]*?(?=##\\s+\\d+\\.\\s+|$)`, 'i');
    let updated = generatedPlan.replace(pattern, '').trim();
    // Renumber remaining sections sequentially
    let sectionNum = 1;
    updated = updated.replace(/^##\s+(\d+)\.\s+(.+)/gm, (match, _num, name) => {
      return `## ${sectionNum++}. ${name}`;
    });
    setGeneratedPlan(updated);
    // Clear stale editing/improve state
    if (editingSection !== null) {
      const maxSection = SECTIONS.length;
      const remainingHeaders = updated.match(/^##\s+\d+\.\s+(.+)/gm);
      const remainingCount = remainingHeaders?.length ?? 0;
      if (editingSection > remainingCount || editingSection === section) {
        setEditingSection(null);
        setEditContent('');
      }
    }
    if (improveInput && improveInput.section >= section) {
      setImproveInput(null);
    }
    toast({ title: "Section Deleted", description: `${sectionHeader} has been removed and sections renumbered.` });
  };

  const startEditSection = (section: number, content: string) => {
    setEditingSection(section);
    setEditContent(content);
  };

  const saveEditSection = () => {
    if (editingSection === null || !generatedPlan) return;
    const sectionHeader = SECTIONS[editingSection - 1];
    const pattern = new RegExp(`(##\\s+${editingSection}\\.\\s+${sectionHeader}[\\s\\S]*?)(?=##\\s+\\d+\\.\\s+|$)`, 'i');
    const updated = generatedPlan.replace(pattern, editContent.trim() + '\n');
    setGeneratedPlan(updated);
    setEditingSection(null);
    setEditContent('');
    toast({ title: "Section Updated", description: "Your changes have been saved." });
  };

  const cancelEdit = () => {
    setEditingSection(null);
    setEditContent('');
  };

  const extractSectionContent = (section: number): string => {
    if (!generatedPlan) return '';
    const sectionHeader = SECTIONS[section - 1];
    const pattern = new RegExp(`(##\\s+${section}\\.\\s+${sectionHeader}[\\s\\S]*?)(?=##\\s+\\d+\\.\\s+|$)`, 'i');
    const match = generatedPlan.match(pattern);
    return match?.[1]?.trim() || '';
  };

  const handleReset = () => {
    setForm(initialForm);
    setGeneratedPlan(null);
    setError(null);
    setActiveVersion('standard');
    setRevisionCount(0);
    setEditingSection(null);
    setImproveInput(null);
  };

  const stripBold = (text: string) => text.replace(/\*\*/g, '');

  const renderPlanContent = () => {
    if (!generatedPlan) return null;
    const lines = generatedPlan.split('\n');
    const elements: JSX.Element[] = [];
    const improveKey = `improve-`;
    let currentSection = 0;
    let sectionLines: string[] = [];
    let sectionStarted = false;

    const flushSection = () => {
      if (!sectionStarted) return;
      const sec = currentSection;
      const sectionName = SECTIONS[sec - 1] || `Section ${sec}`;
      const isEditing = editingSection === sec;

      elements.push(
        <div key={`section-${sec}`} id={`section-${sec}`} className="group relative">
          <h2 className="text-xl font-bold mt-8 mb-3 text-primary">
            {sec}. {sectionName}
          </h2>
          <div className="flex gap-1.5 mb-2 opacity-0 group-hover:opacity-100 transition-opacity">
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs"
              onClick={() => startEditSection(sec, extractSectionContent(sec))}>
              <Edit3 className="w-3 h-3 mr-1" /> Edit
            </Button>
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs"
              onClick={() => handleRegenerateSection(sec)}
              disabled={regeneratingSection === sec}>
              <RefreshCw className={`w-3 h-3 mr-1 ${regeneratingSection === sec ? 'animate-spin' : ''}`} /> Regenerate
            </Button>
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs"
              onClick={() => setImproveInput({ section: sec, prompt: '' })}>
              <TrendingUp className="w-3 h-3 mr-1" /> Improve
            </Button>
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-destructive hover:text-destructive"
              onClick={() => handleDeleteSection(sec)}>
              <Trash2 className="w-3 h-3 mr-1" /> Delete
            </Button>
          </div>
        </div>
      );

      if (improveInput?.section === sec) {
        elements.push(
          <div key={`${improveKey}${sec}`} className="flex gap-2 mb-3 pl-4 border-l-2 border-primary">
            <Input
              placeholder="How should this section be improved?"
              value={improveInput.prompt}
              onChange={e => setImproveInput({ ...improveInput, prompt: e.target.value })}
              className="flex-1 text-sm"
              onKeyDown={e => { if (e.key === 'Enter') handleImproveSection(); }}
            />
            <Button size="sm" onClick={handleImproveSection} disabled={!improveInput.prompt.trim()}>
              <TrendingUp className="w-3 h-3 mr-1" /> Improve
            </Button>
          </div>
        );
      }

      if (isEditing) {
        elements.push(
          <div key={`edit-${sec}`} className="border-2 border-primary rounded-lg p-4 bg-primary/5 mb-4">
            <Textarea
              value={editContent}
              onChange={e => setEditContent(e.target.value)}
              rows={12}
              className="font-mono text-sm"
            />
            <div className="flex gap-2 mt-3">
              <Button size="sm" variant="default" onClick={saveEditSection}>
                <CheckCircle className="w-4 h-4 mr-1" /> Save
              </Button>
              <Button size="sm" variant="ghost" onClick={cancelEdit}>
                <X className="w-4 h-4 mr-1" /> Cancel
              </Button>
            </div>
          </div>
        );
      } else {
        let tableRows: string[] = [];
        let inTable = false;

        const flushTable = () => {
          if (tableRows.length < 2) return;
          const headerCells = tableRows[0].split('|').filter(c => c.trim());
          const bodyRows = tableRows.slice(1);
          elements.push(
            <div key={`table-${sec}-${sectionLines.indexOf(tableRows[0])}`} className="overflow-x-auto my-4 border border-border rounded-lg">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/50 border-b border-border">
                    {headerCells.map((cell, ci) => (
                      <th key={ci} className="px-4 py-2.5 text-left font-semibold text-foreground border-r last:border-r-0 border-border/50">{stripBold(cell.trim())}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {bodyRows.map((row, ri) => {
                    const cells = row.split('|').filter(c => c.trim());
                    return (
                      <tr key={ri} className="border-b last:border-b-0 border-border/50 hover:bg-muted/30">
                        {cells.map((cell, ci) => (
                          <td key={ci} className="px-4 py-2.5 text-muted-foreground border-r last:border-r-0 border-border/50">{stripBold(cell.trim())}</td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
          tableRows = [];
        };

        sectionLines.forEach((l, j) => {
          if (/^\|.+\|$/.test(l.trim()) && l.includes('---') === false) {
            if (!inTable) { inTable = true; }
            tableRows.push(l);
            return;
          }
          if (inTable && /^\|.+\|$/.test(l.trim()) === false) {
            flushTable();
            inTable = false;
          }
          if (inTable && l.trim().includes('---')) {
            return;
          }
          if (inTable) {
            return;
          }

          if (/^###\s/.test(l)) {
            elements.push(<h3 key={`l-${sec}-${j}`} className="text-lg font-semibold mt-5 mb-2 text-foreground">{stripBold(l.replace(/^###\s+/, ''))}</h3>);
          } else if (/^\*\*(.+)\*\*$/.test(l.trim())) {
            elements.push(<h3 key={`l-${sec}-${j}`} className="text-lg font-semibold mt-5 mb-2 text-foreground">{stripBold(l)}</h3>);
          } else if (/^- /.test(l)) {
            elements.push(<li key={`l-${sec}-${j}`} className="ml-5 text-muted-foreground list-disc">{stripBold(l.replace(/^- /, ''))}</li>);
          } else if (/^\* /.test(l)) {
            elements.push(<li key={`l-${sec}-${j}`} className="ml-5 text-muted-foreground list-disc">{stripBold(l.replace(/^\* /, ''))}</li>);
          } else if (l.trim() === '') {
            elements.push(<div key={`l-${sec}-${j}`} className="h-2" />);
          } else {
            elements.push(<p key={`l-${sec}-${j}`} className="text-muted-foreground leading-relaxed">{stripBold(l)}</p>);
          }
        });
        if (inTable) { flushTable(); }
      }

      sectionLines = [];
    };

    lines.forEach((line) => {
      const sectionMatch = line.match(/^##\s+(\d+)\.\s+(.+)/);
      if (sectionMatch) {
        flushSection();
        currentSection = parseInt(sectionMatch[1]);
        sectionStarted = true;
        return;
      }
      if (sectionStarted) {
        sectionLines.push(line);
      }
    });
    flushSection();

    return elements;
  };

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container mx-auto px-4 py-8 md:py-12 max-w-5xl">
        {/* Header */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
          <Button variant="ghost" onClick={() => navigate('/home')} className="mb-4">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Home
          </Button>
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <FileText className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl md:text-3xl font-bold">AI Business Plan Generator</h1>
              <p className="text-muted-foreground text-sm">Turn your idea into a structured, funding-ready business plan</p>
            </div>
          </div>
          {!isPremium && generatedPlan && (
            <Alert className="mt-4 border-primary/30 bg-primary/5">
              <Crown className="h-4 w-4 text-primary" />
              <AlertDescription className="text-sm">
                <strong>Free Plan:</strong> You get 1 revision cycle. <Button variant="link" className="h-auto p-0 text-xs" onClick={() => { trackEvent("attempted_upgrade"); navigate('/pricing'); }}>Upgrade to Premium</Button> for unlimited revisions and DOCX/PDF download.
              </AlertDescription>
            </Alert>
          )}
        </motion.div>

        {/* Input Form */}
        {!generatedPlan && !isGenerating && (
          <motion.form onSubmit={handleGenerate} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-8">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Building2 className="w-5 h-5 text-primary" />
                  Founder Information
                </CardTitle>
              </CardHeader>
              <CardContent className="grid md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Founder Name (Optional)</Label>
                  <Input placeholder="Your full name" value={form.founderName} onChange={e => updateField('founderName', e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Business Name (Optional)</Label>
                  <Input placeholder="Your business name" value={form.businessName} onChange={e => updateField('businessName', e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Country <span className="text-destructive">*</span></Label>
                  <Input placeholder="e.g. Nigeria" value={form.country} onChange={e => updateField('country', e.target.value)} required />
                </div>
                <div className="space-y-2">
                  <Label>State/Province (Optional)</Label>
                  <Input placeholder="e.g. Lagos" value={form.state} onChange={e => updateField('state', e.target.value)} />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Lightbulb className="w-5 h-5 text-primary" />
                  Business Information
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Business Idea <span className="text-destructive">*</span></Label>
                    <Textarea placeholder="Describe your business idea briefly" value={form.businessIdea} onChange={e => updateField('businessIdea', e.target.value)} required rows={2} />
                  </div>
                  <div className="space-y-2">
                    <Label>Industry <span className="text-destructive">*</span></Label>
                    <Input placeholder="e.g. Agriculture, Technology, Retail" value={form.industry} onChange={e => updateField('industry', e.target.value)} required />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Business Stage <span className="text-destructive">*</span></Label>
                  <Select value={form.businessStage} onValueChange={v => updateField('businessStage', v)}>
                    <SelectTrigger><SelectValue placeholder="Select your business stage" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="idea">Idea</SelectItem>
                      <SelectItem value="startup">Startup</SelectItem>
                      <SelectItem value="existing">Existing Business</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Problem Being Solved <span className="text-destructive">*</span></Label>
                  <Textarea placeholder="What problem does your business solve?" value={form.problem} onChange={e => updateField('problem', e.target.value)} required rows={2} />
                </div>
                <div className="space-y-2">
                  <Label>Solution Description <span className="text-destructive">*</span></Label>
                  <Textarea placeholder="How does your product/service solve this problem?" value={form.solution} onChange={e => updateField('solution', e.target.value)} required rows={2} />
                </div>
                <div className="space-y-2">
                  <Label>Target Customers <span className="text-destructive">*</span></Label>
                  <Textarea placeholder="Who are your target customers?" value={form.targetCustomers} onChange={e => updateField('targetCustomers', e.target.value)} required rows={2} />
                </div>
                <div className="grid md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Revenue Model <span className="text-destructive">*</span></Label>
                    <Input placeholder="e.g. Subscription, Marketplace, Direct Sales" value={form.revenueModel} onChange={e => updateField('revenueModel', e.target.value)} required />
                  </div>
                  <div className="space-y-2">
                    <Label>Startup Budget (Optional)</Label>
                    <Input placeholder="e.g. ₦500,000" value={form.startupBudget} onChange={e => updateField('startupBudget', e.target.value)} />
                  </div>
                </div>
                <div className="grid md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Pricing Strategy <span className="text-destructive">*</span></Label>
                    <Input placeholder="How will you price your product?" value={form.pricingStrategy} onChange={e => updateField('pricingStrategy', e.target.value)} required />
                  </div>
                  <div className="space-y-2">
                    <Label>Current Traction (Optional)</Label>
                    <Input placeholder="e.g. 50 beta users, ₦100k revenue" value={form.currentTraction} onChange={e => updateField('currentTraction', e.target.value)} />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Wallet className="w-5 h-5 text-primary" />
                  Funding Information
                </CardTitle>
                <CardDescription>Optional — helps tailor the plan for your funding goals</CardDescription>
              </CardHeader>
              <CardContent className="grid md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Funding Goal (Optional)</Label>
                  <Input placeholder="e.g. ₦2,000,000" value={form.fundingGoal} onChange={e => updateField('fundingGoal', e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Intended Funding Source</Label>
                  <Select value={form.fundingSource} onValueChange={v => updateField('fundingSource', v)}>
                    <SelectTrigger><SelectValue placeholder="Select funding source" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="grant">Grant</SelectItem>
                      <SelectItem value="loan">Loan</SelectItem>
                      <SelectItem value="investor">Investor</SelectItem>
                      <SelectItem value="accelerator">Accelerator</SelectItem>
                      <SelectItem value="bootstrapping">Personal Bootstrapping</SelectItem>
                      <SelectItem value="not_sure">Not Sure</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>

            {error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <Button type="submit" size="lg" className="w-full" disabled={isGenerating}>
              {isGenerating ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Generating Your Business Plan...</>
              ) : (
                <><Sparkles className="w-4 h-4 mr-2" /> Generate Business Plan</>
              )}
            </Button>
          </motion.form>
        )}

        {/* Generating State */}
        {isGenerating && !generatedPlan && (
          <Card className="text-center py-16">
            <CardContent>
              <motion.div animate={{ scale: [1, 1.1, 1] }} transition={{ repeat: Infinity, duration: 2 }}>
                <FileText className="w-16 h-16 text-primary mx-auto mb-4" />
              </motion.div>
              <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4 text-primary" />
              <h3 className="text-lg font-semibold mb-2">Crafting Your Business Plan</h3>
              <p className="text-muted-foreground text-sm max-w-md mx-auto">
                Our AI is analyzing your inputs and building a comprehensive, funding-ready business plan. This may take a moment...
              </p>
            </CardContent>
          </Card>
        )}

        {/* Generated Plan */}
        {generatedPlan && !isGenerating && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
            {/* Top Toolbar */}
            <Card>
              <CardContent className="p-4 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <FileText className="w-5 h-5 text-primary" />
                    <h2 className="text-lg font-bold">Your Business Plan</h2>
                    <Badge variant="outline" className="text-xs">
                      {isPremium ? 'Premium' : 'Free'} &middot; {revisionCount} revision{revisionCount !== 1 ? 's' : ''}
                    </Badge>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={handleReset}>
                      Start Over
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => navigate('/home')}>
                      Back to Home
                    </Button>
                  </div>
                </div>

                {/* Version Switcher */}
                <div>
                  <Label className="text-xs text-muted-foreground mb-1.5 block">Plan Version</Label>
                  <Tabs value={activeVersion} onValueChange={v => handleSwitchVersion(v as VersionType)} className="w-full">
                    <TabsList className="w-full flex-wrap h-auto">
                      <TabsTrigger value="standard" className="text-xs flex-1 min-w-[80px]">
                        <LayoutList className="w-3 h-3 mr-1" /> Standard
                      </TabsTrigger>
                      {['grant', 'investor', 'loan', 'accelerator'].map(v => (
                        <TabsTrigger key={v} value={v} className="text-xs flex-1 min-w-[80px]">
                          <Target className="w-3 h-3 mr-1" />
                          {v.charAt(0).toUpperCase() + v.slice(1)}
                        </TabsTrigger>
                      ))}
                    </TabsList>
                  </Tabs>
                </div>

                {/* Action Buttons */}
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => handleAdjustLength('shorter')} disabled={isAdjustingLength}>
                    <Shrink className="w-3.5 h-3.5 mr-1.5" /> Make Shorter
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => handleAdjustLength('longer')} disabled={isAdjustingLength}>
                    <Expand className="w-3.5 h-3.5 mr-1.5" /> Make Longer
                  </Button>
                  <div className="flex-1" />
                  <Button size="sm" variant={savePlanId ? "outline" : "default"} onClick={handleSavePlan} disabled={isSaving}>
                    {isSaving ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : savePlanId ? <CheckCircle className="w-3.5 h-3.5 mr-1.5" /> : <Save className="w-3.5 h-3.5 mr-1.5" />}
                    {savePlanId ? "Saved" : "Save Plan"}
                  </Button>
                  <Button size="sm" variant="default" onClick={() => { trackEvent("attempted_download", { format: "pdf" }); downloadPDF(generatedPlan, form.businessName); }} disabled={!isPremium} title={!isPremium ? 'Upgrade to Premium to download PDF' : ''}>
                    <Book className="w-3.5 h-3.5 mr-1.5" /> PDF {!isPremium && <Lock className="w-3 h-3 ml-1" />}
                  </Button>
                  <Button size="sm" variant="default" onClick={() => { trackEvent("attempted_download", { format: "docx" }); downloadDOCX(generatedPlan, form.businessName); }} disabled={!isPremium} title={!isPremium ? 'Upgrade to Premium to download DOCX' : ''}>
                    <Download className="w-3.5 h-3.5 mr-1.5" /> DOCX {!isPremium && <Lock className="w-3 h-3 ml-1" />}
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Plan Display */}
            <Card
              onCopy={e => e.preventDefault()}
              onCut={e => e.preventDefault()}
              className="select-none"
            >
              <CardContent className="p-6 md:p-8">
                {renderPlanContent()}
              </CardContent>
            </Card>

            {/* Bottom Actions */}
            <div className="flex flex-wrap justify-center gap-3">
              <Button variant="outline" onClick={handleReset}>
                Generate Another Plan
              </Button>
              {!isPremium && (
                <Button variant="default" onClick={() => { trackEvent("attempted_upgrade"); navigate('/pricing'); }}>
                  <Crown className="w-4 h-4 mr-2" /> Upgrade to Premium
                </Button>
              )}
            </div>
          </motion.div>
        )}

        {/* Loading overlay for background operations */}
        <AnimatePresence>
          {isGenerating && generatedPlan && (
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center"
            >
              <Card className="text-center py-8 px-12">
                <CardContent>
                  <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4 text-primary" />
                  <h3 className="font-semibold">Updating Your Business Plan...</h3>
                </CardContent>
              </Card>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
      <Footer />
    </div>
  );
};

export default BusinessPlanGenerator;
