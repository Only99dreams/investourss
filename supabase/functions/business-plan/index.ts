import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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

const SYSTEM_PROMPT = `You are an expert business plan writer and startup consultant for Investours. Your job is to transform a user's business idea into a structured, funding-ready business plan.

Generate the business plan in the following sections with clear headings. Be specific, actionable, and realistic. Where exact market data is unavailable, provide realistic estimates and clearly state assumptions.

## 1. Executive Summary
- Business overview
- Opportunity summary
- Business objectives

## 2. Problem Statement
- Pain point
- Market need
- Why the problem matters

## 3. Solution
- Product/service description
- Value proposition
- Customer benefits

## 4. Market Opportunity
- Industry overview
- Target customers
- Market trends
- Key industry statistics
- TAM (Total Addressable Market)
- SAM (Serviceable Available Market)
- SOM (Serviceable Obtainable Market)
- Clearly state any assumptions made

## 5. Competitive Analysis
- Direct competitors
- Indirect competitors
- Competitive landscape
- Competitive advantage (why this business can win)

## 6. Business Model
- Revenue streams
- Pricing strategy
- Customer acquisition approach
- Growth strategy

## 7. Marketing & Sales Strategy
- Online channels
- Offline channels
- Partnerships
- Community strategy
- Customer retention strategy
(Adapt recommendations to the user's country and industry)

## 8. Operations Plan
- Daily operations
- Team requirements
- Technology requirements
- Key milestones

## 9. Financial Projections
- Startup costs
- Revenue projection (12 months)
- Expense projection
- Gross profit estimate
- Break-even estimate
- Key financial assumptions (all assumptions must be clearly stated)

## 10. Risk Analysis
- Key risks
- Mitigation strategies
- Contingency plans

## 11. Funding Readiness Assessment
- Strengths
- Weaknesses
- Missing information
- Recommendations
- Funding Readiness Score (0-100)

## 12. Action Plan
- Next 7 days
- Next 30 days
- Next 90 days
- Practical actions the founder should take`;

function buildUserPrompt(formData: any, version?: string): string {
  let prompt = `Generate a funding-ready business plan based on the following information:

Founder Information:
- Founder Name: ${formData.founderName || 'Not provided'}
- Business Name: ${formData.businessName || 'Not provided'}
- Country: ${formData.country}
- State/Province: ${formData.state || 'Not provided'}

Business Information:
- Business Idea: ${formData.businessIdea}
- Industry: ${formData.industry}
- Business Stage: ${formData.businessStage}
- Problem Being Solved: ${formData.problem}
- Solution Description: ${formData.solution}
- Target Customers: ${formData.targetCustomers}
- Revenue Model: ${formData.revenueModel}
- Startup Budget: ${formData.startupBudget || 'Not specified'}
- Pricing Strategy: ${formData.pricingStrategy}
- Current Traction: ${formData.currentTraction || 'Not provided'}

Funding Information:
- Funding Goal: ${formData.fundingGoal || 'Not specified'}
- Intended Funding Source: ${formData.fundingSource || 'Not sure'}`;

  if (version && version !== 'standard') {
    const versionPrompts: Record<string, string> = {
      grant: `\n\nIMPORTANT: Write this business plan as a GRANT APPLICATION. Emphasize social impact, community benefit, sustainability, and how the funding will be used. Use language that grant committees expect. Include measurable outcomes and alignment with common grantmaker priorities.`,
      investor: `\n\nIMPORTANT: Write this business plan as an INVESTOR PITCH. Emphasize market opportunity, scalability, return on investment, competitive advantage, traction, and growth potential. Use language that angel investors and VCs expect. Include clear ROI projections and exit strategy considerations.`,
      loan: `\n\nIMPORTANT: Write this business plan as a LOAN APPLICATION. Emphasize financial stability, cash flow, collateral, repayment capability, risk management, and business sustainability. Use language that banks and lending institutions expect. Include detailed financial projections and debt service coverage.`,
      accelerator: `\n\nIMPORTANT: Write this business plan as an ACCELERATOR APPLICATION. Emphasize innovation, growth potential, team capability, market fit, scalability, and mentorship needs. Use language that accelerator programs expect. Include milestones and how the program would help achieve them.`,
    };
    prompt += versionPrompts[version] || '';
  }

  prompt += `\n\nPlease generate a comprehensive, professional business plan covering all 12 sections.`;
  return prompt;
}

async function callAI(messages: { role: string; content: string }[]) {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

  const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    if (response.status === 429) throw { status: 429, message: "Rate limit exceeded. Please try again in a moment." };
    if (response.status === 402) throw { status: 402, message: "Service temporarily unavailable. Please try again later." };
    throw new Error(`AI Gateway error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || "I apologize, but I couldn't generate a response.";
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { action = 'generate', formData, currentPlan, sectionNumber, improveInstruction, lengthDirection, version } = body;

    let result = '';

    switch (action) {
      case 'generate': {
        result = await callAI([
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: buildUserPrompt(formData, version) },
        ]);
        break;
      }

      case 'switch_version': {
        result = await callAI([
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: buildUserPrompt(formData, version) },
        ]);
        break;
      }

      case 'regenerate_section': {
        const sectionName = SECTIONS[sectionNumber - 1] || `Section ${sectionNumber}`;
        const regenPrompt = `I have a business plan and I want to regenerate ONLY section ${sectionNumber}: "${sectionName}".

Here is the current full business plan:
---
${currentPlan}
---

Please regenerate ONLY section ${sectionNumber} (${sectionName}). 
Return ONLY the content for this section with its heading, nothing else.
Make it detailed, professional, and consistent with the rest of the plan.`;

        result = await callAI([
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: regenPrompt },
        ]);
        break;
      }

      case 'improve_section': {
        const sectionName = SECTIONS[sectionNumber - 1] || `Section ${sectionNumber}`;
        const improvePrompt = `I have a business plan and I want to IMPROVE section ${sectionNumber}: "${sectionName}" based on this feedback: "${improveInstruction}"

Here is the current full business plan:
---
${currentPlan}
---

Please rewrite ONLY section ${sectionNumber} (${sectionName}) incorporating this improvement feedback.
Return ONLY the improved content for this section with its heading, nothing else.
Make it significantly better based on the feedback provided.`;

        result = await callAI([
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: improvePrompt },
        ]);
        break;
      }

      case 'adjust_length': {
        const dir = lengthDirection === 'shorter' ? 'SHORTER and more CONCISE' : 'LONGER and more DETAILED';
        const adjustPrompt = `I have a business plan that needs to be made ${dir}.

Here is the current full business plan:
---
${currentPlan}
---

Please rewrite the ENTIRE business plan to be ${dir}.
Keep all 12 sections but make each section ${dir === 'SHORTER and more CONCISE' ? 'more concise and to-the-point, removing fluff while keeping key information' : 'more detailed with deeper analysis, more examples, and richer content'}.
Return the complete revised business plan.`;

        result = await callAI([
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: adjustPrompt },
        ]);
        break;
      }

      default:
        throw new Error(`Unknown action: ${action}`);
    }

    return new Response(JSON.stringify({ response: result, success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error: any) {
    const status = error?.status || 500;
    const message = error?.message || error?.toString() || "Unknown error occurred";
    return new Response(JSON.stringify({ error: message }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
