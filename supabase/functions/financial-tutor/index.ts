import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { messages, userId, userLevel } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    const levelPrompts = {
      beginner: `Explain financial concepts simply with relatable examples. Use analogies and everyday language. Keep explanations short and accessible. For example: "Think of budgeting like planning a road trip - you need to know how much gas money you have before deciding where to go."`,
      intermediate: `Teach with practical investment examples. Use real-world scenarios and actionable advice. Include numbers and percentages. For example: "An ETF like VOO tracks the S&P 500, giving you instant diversification across 500 companies with just $1."`,
      advanced: `Provide strategic and analytical explanations. Use professional terminology and advanced concepts. Include portfolio theory and market analysis. For example: "Diversification reduces unsystematic risk through correlation analysis. A balanced portfolio typically targets 0.6-0.8 correlation coefficients."`
    };

    const level = userLevel || "beginner";
    const systemPrompt = `You are a friendly and knowledgeable AI Financial Tutor for Investours, an educational platform focused on financial literacy and smart investing.

Your role is to:
- Explain financial concepts in simple, easy-to-understand terms
- Help users understand personal finance topics like budgeting, saving, investing basics, compound interest, etc.
- Provide educational information about different types of investments (stocks, bonds, mutual funds, ETFs, etc.)
- Explain economic concepts and how they affect personal finances
- Give general guidance on financial planning and goal setting
- Be encouraging and supportive of users' financial learning journey

Important guidelines:
- Always provide educational information, never specific investment advice
- If someone asks about specific investments or wants to verify if something is a scam, politely direct them to use the AI Vetting tool on Investours
- Keep responses concise but comprehensive
- Use examples when helpful
- Be friendly and approachable
- If you don't know something, be honest about it
- Include a short quiz question at the end to reinforce learning
- Suggest the next best lesson based on their progress

Personalization for ${level} level: ${levelPrompts[level as keyof typeof levelPrompts]}

Remember: You're an educator, not a financial advisor. Always recommend users consult with licensed professionals for personalized financial advice.`;

    console.log("Calling Lovable AI with messages:", messages.length);

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          ...messages
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("AI Gateway error:", response.status, errorText);
      
      if (response.status === 429) {
        return new Response(JSON.stringify({ 
          error: "Rate limit exceeded. Please try again in a moment." 
        }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      
      if (response.status === 402) {
        return new Response(JSON.stringify({ 
          error: "Service temporarily unavailable. Please try again later." 
        }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      
      throw new Error(`AI Gateway error: ${response.status}`);
    }

    const data = await response.json();
    const assistantResponse = data.choices?.[0]?.message?.content || "I apologize, but I couldn't generate a response.";

    console.log("Successfully generated response");

    return new Response(JSON.stringify({ 
      response: assistantResponse,
      success: true 
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("Financial tutor error:", error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : "Unknown error occurred" 
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
