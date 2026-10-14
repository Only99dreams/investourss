import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { query, analysisType, userId } = await req.json();
    
    if (!query || query.trim() === '') {
      return new Response(JSON.stringify({ error: 'Query is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const MODEL_API_KEY = Deno.env.get('MODEL_API_KEY');
    if (!MODEL_API_KEY) {
      throw new Error('MODEL_API_KEY is not configured');
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Different prompts for quick search vs deep analysis
    const systemPrompt = analysisType === 'deep' 
      ? `You are an expert investment fraud analyst for Investours, an African fintech platform. 
         Perform a comprehensive deep analysis of the provided investment opportunity or company.
         
         Your analysis must include:
         1. **Risk Score** (0-100): Where 0 is completely safe and 100 is definite scam
         2. **Risk Level**: "safe", "low", "medium", "high", or "critical"
         3. **Company Analysis**: What you know about this company/scheme
         4. **Red Flags**: List specific warning signs identified
         5. **Green Flags**: List positive indicators if any
         6. **Regulatory Status**: Known regulatory compliance or violations
         7. **Similar Scams**: Reference to known similar fraudulent schemes
         8. **Recommendations**: Specific actionable advice for the user
         9. **Confidence Level**: How confident you are in this assessment (low/medium/high)
         
         Format your response as JSON with these exact keys:
         {
           "riskScore": number,
           "riskLevel": "safe" | "low" | "medium" | "high" | "critical",
           "summary": "Brief 2-3 sentence summary",
           "companyAnalysis": "Detailed analysis",
           "redFlags": ["flag1", "flag2"],
           "greenFlags": ["flag1", "flag2"],
           "regulatoryStatus": "Status description",
           "similarScams": ["scam1", "scam2"],
           "recommendations": ["rec1", "rec2"],
           "confidence": "low" | "medium" | "high"
         }`
      : `You are a quick investment scam detector for Investours, an African fintech platform.
         Quickly assess if the provided investment opportunity shows common scam patterns.
         
         Focus on:
         - Unrealistic return promises (e.g., 50%+ monthly)
         - Ponzi/pyramid scheme indicators
         - Pressure tactics or urgency
         - Lack of regulatory registration
         - Common Nigerian/African investment scam patterns
         
         Format your response as JSON:
         {
           "riskLevel": "safe" | "warning" | "danger",
           "summary": "Brief assessment in 2-3 sentences",
           "keyFindings": ["finding1", "finding2", "finding3"],
           "recommendation": "Single actionable recommendation"
         }`;

    const userPrompt = `Analyze this investment opportunity or company: "${query}"`;

    console.log(`Processing ${analysisType} analysis for: ${query}`);

    const response = await fetch(
      'https://api.meta.ai/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${MODEL_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'muse-spark-1.3',
          messages: [
            { role: 'developer', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          response_format: {
            type: 'json_schema',
            json_schema: analysisType === 'deep'
              ? {
                  name: 'deep_scam_analysis',
                  schema: {
                    type: 'object',
                    properties: {
                      riskScore: { type: 'number', minimum: 0, maximum: 100 },
                      riskLevel: { type: 'string', enum: ['safe', 'low', 'medium', 'high', 'critical'] },
                      summary: { type: 'string' },
                      companyAnalysis: { type: 'string' },
                      redFlags: { type: 'array', items: { type: 'string' } },
                      greenFlags: { type: 'array', items: { type: 'string' } },
                      regulatoryStatus: { type: 'string' },
                      similarScams: { type: 'array', items: { type: 'string' } },
                      recommendations: { type: 'array', items: { type: 'string' } },
                      confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
                    },
                    required: ['riskScore', 'riskLevel', 'summary', 'companyAnalysis', 'redFlags', 'greenFlags', 'regulatoryStatus', 'similarScams', 'recommendations', 'confidence'],
                    additionalProperties: false,
                  },
                }
              : {
                  name: 'quick_scam_analysis',
                  schema: {
                    type: 'object',
                    properties: {
                      riskLevel: { type: 'string', enum: ['safe', 'warning', 'danger'] },
                      summary: { type: 'string' },
                      keyFindings: { type: 'array', items: { type: 'string' } },
                      recommendation: { type: 'string' },
                    },
                    required: ['riskLevel', 'summary', 'keyFindings', 'recommendation'],
                    additionalProperties: false,
                  },
                },
          },
        }),
      },
    );

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: 'Rate limit exceeded. Please try again later.' }), {
          status: 429,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: 'Service temporarily unavailable. Please try again later.' }), {
          status: 402,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const errorText = await response.text();
      console.error('Meta Model API error:', response.status, errorText);
      throw new Error('AI analysis failed');
    }

    const data = await response.json();
    const aiContent = data.choices?.[0]?.message?.content || '';

    if (!aiContent) {
      throw new Error('No response from AI');
    }

    // Parse the JSON response from AI
    let analysisResult;
    try {
      // Extract JSON from potential markdown code blocks
      const jsonMatch = aiContent.match(/```json\s*([\s\S]*?)\s*```/) || 
                       aiContent.match(/```\s*([\s\S]*?)\s*```/) ||
                       [null, aiContent];
      analysisResult = JSON.parse(jsonMatch[1] || aiContent);
    } catch (parseError) {
      console.error('Failed to parse AI response:', aiContent);
      // Return a structured error response
      analysisResult = analysisType === 'deep' 
        ? {
            riskScore: 50,
            riskLevel: 'medium',
            summary: 'Unable to fully analyze. Please verify through official channels.',
            companyAnalysis: aiContent,
            redFlags: [],
            greenFlags: [],
            regulatoryStatus: 'Unknown',
            similarScams: [],
            recommendations: ['Verify with local regulators', 'Do thorough due diligence'],
            confidence: 'low'
          }
        : {
            riskLevel: 'warning',
            summary: 'Analysis incomplete. Please exercise caution and do additional research.',
            keyFindings: ['Could not complete full analysis'],
            recommendation: 'Verify this investment through official regulatory channels.'
          };
    }

    // Log the search to database
    const { error: logError } = await supabase.from('ai_search_logs').insert({
      user_id: userId || null,
      query: query,
      search_type: analysisType || 'quick',
      result: JSON.stringify(analysisResult),
      success: true
    });

    if (logError) {
      console.error('Failed to log search:', logError);
    }

    console.log(`Analysis complete for: ${query}`);

    return new Response(JSON.stringify({ 
      success: true, 
      analysis: analysisResult,
      analysisType: analysisType || 'quick'
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Scam detection error:', error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : 'Analysis failed' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
