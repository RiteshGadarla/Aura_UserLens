// server.js - Gemini API Proxy for Reliable Q&A
import express from 'express';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
dotenv.config();

const app = express();
// Enable CORS for browser extension communication
app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    next();
});
app.use(express.json({ limit: '1mb' }));

// --- CONFIGURATION ---
// IMPORTANT: You must change your .env file to use GEMINI_API_KEY
const GEMINI_API_KEY = process.env.GEMINI_API_KEY; 
const MODEL_NAME = 'gemini-2.5-flash-preview-09-2025';
const PORT = process.env.PORT && process.env.PORT.trim() !== '' ? Number(process.env.PORT) : 3000;

if (!GEMINI_API_KEY) {
  console.error('CRITICAL: Set GEMINI_API_KEY in your .env file to enable the chatbot.');
  process.exit(1);
}

// JSON Schema Definition to enforce the response contract (tldr, bullets, details, citations)
const RESPONSE_SCHEMA = {
    type: "OBJECT",
    properties: {
        tldr: { 
            type: "STRING", 
            description: "A short, one-sentence summary (TL;DR) of the answer." 
        },
        bullets: { 
            type: "ARRAY", 
            description: "A list of 3-5 key bullet points summarizing the main findings.", 
            items: { type: "STRING" } 
        },
        details: { 
            type: "STRING", 
            description: "A more detailed paragraph providing context and explanation." 
        },
        citations: { 
            type: "ARRAY", 
            description: "An array of citation sources used from the context. Only reference sources provided in the context blocks.", 
            items: { 
                type: "OBJECT",
                properties: {
                    heading: { type: "STRING" },
                    anchor: { type: "STRING" }
                }
            } 
        }
    },
    propertyOrdering: ["tldr", "bullets", "details", "citations"]
};

function buildContextText(sections){
  if (!Array.isArray(sections) || sections.length === 0) return '';
  return sections.slice(0, 6).map((s, i) => {
    const heading = (s.heading || s.title || `Section ${i+1}`).toString().trim();
    // Keep up to 2000 chars but don't drop everything silently
    const rawText = (s.text || s.body || s.content || '').toString();
    const snippet = rawText.trim().slice(0, 2000).replace(/\s+/g,' ').trim();
    const anchor = (s.anchor || s.url || '').toString().trim();
    return `[CONTEXT_BLOCK_${i+1}]\nHEADING: ${heading}\nTEXT:\n${snippet}\nANCHOR: ${anchor}\n`;
  }).filter(Boolean).join('\n');
}


app.post('/ask', async (req, res) => {
    console.log('[/ask] incoming body:', JSON.stringify(req.body).slice(0, 2000));

    const { question = '', sections = [], pageInfo = {} } = req.body || {};

    // Basic validations
    if (!question || typeof question !== 'string') {
        return res.status(400).json({
        tldr: 'Bad Request',
        bullets: ['Missing or invalid "question" in request body.'],
        details: 'Provide { question: string, sections: [...], pageInfo: {...} }',
        citations: []
        });
    }

    // If client provided no sections, either fail fast or include an explicit fallback.
    // Option A (recommended): return 400 so the caller fixes the request:
    if (!Array.isArray(sections) || sections.length === 0) {
        return res.status(400).json({
        tldr: 'No Context Provided',
        bullets: ['The request did not include any "sections". The model requires context blocks.'],
        details: 'Include a non-empty "sections" array in the request body. Example: sections: [{ heading, text, anchor }, ...]',
        citations: []
        });
    }

    const context = buildContextText(sections);

    // If buildContextText produced an empty string (e.g., all sections had no text), return helpful error
    if (!context || context.trim().length === 0) {
        return res.status(400).json({
        tldr: 'Empty Context Blocks',
        bullets: ['Context blocks were present but contained no usable text.'],
        details: 'Ensure each section has a non-empty "text" (or "body" / "content") field.',
        citations: []
        });
    }
    console.log("Context being sent:\n", context);
  // System instruction defines the model's role and output format.
  const systemInstruction = `You are a helpful text analysis assistant. Your task is to analyze the provided CONTEXT BLOCKS from a webpage and answer the user's QUESTION strictly based on that content. You MUST format your response as a single JSON object that conforms to the provided schema. Do not include any text outside the JSON object. The citations should reference the 'HEADING' and 'ANCHOR' of the CONTEXT BLOCKS you used.`;
  const userPrompt = `Page Title: ${pageInfo.title}\nPage URL: ${pageInfo.url}\n\nCONTEXT BLOCKS:\n${context}\n\nQUESTION: ${question}`;

  const payload = {
    contents: [{ parts: [{ text: userPrompt }] }],
    systemInstruction: { parts: [{ text: systemInstruction }] },
    generationConfig: {
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA
    }
  };

  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:generateContent?key=${GEMINI_API_KEY}`;
  
  try {
    const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error('Gemini API Error:', response.status, errorText);
        return res.status(502).json({ 
            tldr: 'LLM Error', 
            bullets: ['API call failed.'], 
            details: `Gemini API Status ${response.status}: ${errorText.slice(0, 100)}`,
            citations: []
        });
    }

    const result = await response.json();
    const candidate = result.candidates?.[0];

    if (candidate && candidate.content?.parts?.[0]?.text) {
        let jsonText = candidate.content.parts[0].text;
        let parsedData;
        try {
            parsedData = JSON.parse(jsonText);
            // Ensure lists are arrays even if model skips elements
            parsedData.bullets = Array.isArray(parsedData.bullets) ? parsedData.bullets : [];
            parsedData.citations = Array.isArray(parsedData.citations) ? parsedData.citations : [];
        } catch (e) {
            // Handle malformed JSON response
            console.error('Failed to parse Gemini JSON response:', e, jsonText);
            parsedData = { 
                tldr: 'Parsing Error', 
                bullets: ['Could not read the LLM response. Check the server console for details.'], 
                details: jsonText.slice(0, 500), 
                citations: []
            };
        }
        return res.json(parsedData);

    } else {
        // Handle cases where candidate structure is unexpected (e.g., blocked due to safety)
        const detail = JSON.stringify(result, null, 2).slice(0, 500);
        console.warn('Unexpected Gemini response structure:', detail);
        return res.status(502).json({
            tldr: 'Model Output Failed',
            bullets: ['LLM did not return a valid answer candidate.'],
            details: detail,
            citations: []
        });
    }

  } catch (err) {
    console.error('Server error during API call', err);
    return res.status(500).json({ 
        tldr: 'Proxy Error',
        bullets: ['The proxy server encountered a network failure.'],
        details: String(err),
        citations: []
    });
  }
});




app.post('/detect', async (req, res) => {
  try {
    const body = req.body || {};
    const pageInfo = body.pageInfo || {};
    const sections = body.sections || [];
    // Build a short prompt. Keep the text small — send headings or a sample of each section.
    const snippets = sections.map(s => `Heading: ${s.heading}\nText: ${s.text.slice(0,800)}\n`).join('\n---\n');

    const prompt = `
You are an assistant that finds emotionally impactful or dangerous words or vulgar words in the input text and suggests milder replacements.
Return ONLY a JSON object mapping each detected word or short phrase (lowercase) to a single-word or short-phrase replacement.
Do NOT include commentary, do not include extra fields.
If no dangerous words are found return an empty JSON object {}.

Input:
${snippets}
`;

    // Example: call Gemini (pseudo). Replace with actual endpoint/provider.
    // --- PSEUDO: replace with real call to Gemini/VertexAI ---
    // For example, using a hypothetical endpoint (adjust headers & body as required).
    const modelResp = await fetch('https://api.example.com/v1/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + GEMINI_API_KEY
      },
      body: JSON.stringify({
        model: 'gemini-1', // update appropriately
        prompt: prompt,
        max_tokens: 400
      })
    });
    const modelJson = await modelResp.json();
    // Extract textual output from modelJson (depends on provider)
    const textOutput = (modelJson && modelJson.output_text) ? modelJson.output_text : JSON.stringify(modelJson);

    // Try to parse JSON object from output
    let mapping = {};
    const m = textOutput.match(/(\{[\s\S]*\})/);
    if (m && m[1]) {
      try { mapping = JSON.parse(m[1]); } catch(e) {}
    } else {
      // fallback parse: lines like "gun: firearm"
      const lines = textOutput.split('\n').map(l => l.trim()).filter(Boolean);
      for (const ln of lines) {
        const mm = ln.match(/^["']?([^"'\:\-]+)["']?\s*[:\-]\s*["']?(.+?)["']?$/);
        if (mm) mapping[mm[1].trim().toLowerCase()] = mm[2].trim();
      }
    }

    // ensure values are strings
    const normalized = {};
    for (const k of Object.keys(mapping||{})) {
      if (!mapping[k]) continue;
      normalized[String(k).toLowerCase()] = String(mapping[k]);
    }

    return res.json(normalized);
  } catch (err) {
    console.error('detect error', err);
    return res.status(500).send(String(err));
  }
});

app.listen(PORT, ()=> console.log(`Gemini API proxy listening on ${PORT} — model=${MODEL_NAME}`));