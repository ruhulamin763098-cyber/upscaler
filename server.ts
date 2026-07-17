/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from 'express';
import path from 'path';
import dotenv from 'dotenv';
import { GoogleGenAI, Type } from '@google/genai';
import { createServer as createViteServer } from 'vite';

// Load environment variables
dotenv.config();

const isProd = process.env.NODE_ENV === 'production';
const PORT = 3000;

async function startServer() {
  const app = express();

  // Raise body parsing limit for base64 image uploads
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));

  // Initialize Gemini client (Lazy-loaded safely)
  let aiClient: GoogleGenAI | null = null;
  function getGeminiClient() {
    if (!aiClient) {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        throw new Error('GEMINI_API_KEY environment variable is not defined.');
      }
      aiClient = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });
    }
    return aiClient;
  }

  // --- API Endpoint: Gemini Smart Image Analysis ---
  app.post('/api/gemini/analyze', async (req, res) => {
    try {
      const { imageBase64, mimeType } = req.body;
      if (!imageBase64) {
        return res.status(400).json({ error: 'Missing imageBase64 in request body.' });
      }

      const client = getGeminiClient();

      const imagePart = {
        inlineData: {
          mimeType: mimeType || 'image/png',
          data: imageBase64,
        },
      };

      const promptPart = {
        text: 'Analyze this image and suggest the optimal image upscaling, sharpening, and color correction settings. ' +
              'Consider details, edges, noise/compression artifacts, and general contrast. Give your response matching the requested JSON schema.',
      };

      const response = await client.models.generateContent({
        model: 'gemini-3.5-flash',
        contents: { parts: [imagePart, promptPart] },
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              caption: {
                type: Type.STRING,
                description: 'A beautiful, descriptive, one-sentence caption describing the image contents.',
              },
              algorithm: {
                type: Type.STRING,
                description: 'Recommended upscaling algorithm based on contents: "lanczos" for photographs with rich fine details, "bicubic" for smooth/clean graphics, "bilinear" for simple patterns, "nearest" for retro pixel art, games, or high-contrast crisp lines.',
              },
              scale: {
                type: Type.NUMBER,
                description: 'Recommended scale factor (usually 2, 3, or 4) based on file clarity.',
              },
              denoise: {
                type: Type.STRING,
                description: 'Recommended denoise level to handle noise or compression artifacts: "off" (clean image), "light" (mild noise), "medium" (standard JPEG artifacts), or "strong" (heavy noise/grain).',
              },
              sharpen: {
                type: Type.INTEGER,
                description: 'Recommended sharpening intensity percentage from 0 to 100 to enhance edge definition.',
              },
              brightness: {
                type: Type.INTEGER,
                description: 'Recommended brightness percentage (100 is neutral, adjust slightly if image is too dark/bright, range 90-115).',
              },
              contrast: {
                type: Type.INTEGER,
                description: 'Recommended contrast percentage (100 is neutral, adjust slightly to pop elements, range 95-115).',
              },
              saturation: {
                type: Type.INTEGER,
                description: 'Recommended saturation percentage (100 is neutral, range 95-120 to enrich or calm color tone).',
              },
              reasoning: {
                type: Type.STRING,
                description: 'A detailed explanation explaining why these specific upscale algorithms and visual sliders are recommended for this content.',
              },
            },
            required: [
              'caption',
              'algorithm',
              'scale',
              'denoise',
              'sharpen',
              'brightness',
              'contrast',
              'saturation',
              'reasoning',
            ],
          },
        },
      });

      if (!response.text) {
        throw new Error('Gemini API returned an empty response.');
      }

      const recommendationData = JSON.parse(response.text.trim());
      res.json(recommendationData);
    } catch (err: any) {
      console.error('Gemini Analysis Error:', err);
      res.status(500).json({
        error: 'Failed to analyze the image using Gemini API.',
        details: err.message || err,
      });
    }
  });

  // --- Vite Dev Server Middleware or Production Static Server ---
  if (!isProd) {
    console.log('Running in DEVELOPMENT mode. Initializing Vite middleware...');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    console.log('Running in PRODUCTION mode. Serving compiled static assets...');
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
});
