import express from 'express';
import { verifyAuth } from '../middleware/auth.js';
import { logger } from '../utils/logger.js';
import { getModelManager, ModelManagerError } from '../services/modelManager/index.js';
import { toFoodAnalysis, toAppGeminiShape } from '../services/foodAnalysis.js';
import {
  getFoodOptions,
  getPublicFoodOptions,
  buildCategoryPromptSection,
  buildHealthTypePromptSection,
  buildAllowedValuesPromptSection,
} from '../services/foodOptions.js';

const router = express.Router();

// Models, quotas, queueing and retries are configured in services/modelManager/config.js
// (GEMINI_MODELS, MODEL_RPM_LIMIT, MODEL_RPD_LIMIT, SCAN_* env vars).

// Debug helper (DEBUG_AI_RESPONSE=true): prints the AI's raw reply and what the backend
// normalized it to. Turn off when done; it logs food data only (no user or key data).
// Unusable replies are logged by the model manager as "model.failed kind=invalid_response".
function logAiResponse(model, { analysis, aiCategory, aiType, text, finishReason }) {
  logger.debug(`[ai-debug] model=${model} finishReason=${finishReason} chars=${text.length}`);
  logger.debug(`[ai-debug] food="${analysis.foodName}" calories=${analysis.calories} confidence=${analysis.confidence}`);
  logger.debug(`[ai-debug] category: AI="${aiCategory}" -> sent="${analysis.category}"`);
  logger.debug(`[ai-debug] type:     AI="${aiType}" -> sent="${analysis.type}"`);
  logger.debug(`[ai-debug] raw reply:\n${text}`);
}

/**
 * GET /api/scan/options
 * Category / health type / meal type lists for the app's pickers (public, no user data).
 * Edit config/foodOptions.json to change them; no app update needed.
 */
router.get('/options', (req, res) => {
  try {
    res.set('Cache-Control', 'public, max-age=300');
    res.json(getPublicFoodOptions());
  } catch (error) {
    logger.error(`Food options unavailable: ${error.message}`);
    res.status(503).json({
      error: 'AI Food Analyzer Unavailable',
      code: 'OPTIONS_UNAVAILABLE',
      message: 'The AI Food Analyzer is temporarily unavailable. Please try again later.'
    });
  }
});

router.post('/', verifyAuth, async (req, res) => {
  try {
    const { imageBase64 } = req.body;

    if (!imageBase64) {
      logger.warn(`Scan rejected for user ${req.user.uid}: missing imageBase64`);
      return res.status(400).json({
        error: 'Unreadable Photo',
        code: 'BAD_REQUEST',
        message: "The AI couldn't read this photo. Please try again with a clear photo of your food."
      });
    }

    const geminiApiKey = process.env.GEMINI_API_KEY;
    if (!geminiApiKey) {
      logger.error('Scan unavailable: GEMINI_API_KEY is not configured');
      return res.status(500).json({
        error: 'AI Food Analyzer Unavailable',
        code: 'PROVIDER_AUTH',
        message: 'The AI Food Analyzer is temporarily unavailable. Please try again later.'
      });
    }

    logger.info(`Food scan requested by user: ${req.user.uid}`);

    // Comprehensive food analysis prompt; category/type sections come from config/foodOptions.json
    const foodOptions = getFoodOptions();
    const prompt = `Analyze this food image and estimate its nutrition information.

IMPORTANT:
- Return ONLY one valid JSON object.
- Do NOT return markdown.
- Do NOT return explanations outside the JSON.
- Do NOT add extra fields.
- All nutrition values must represent the ENTIRE visible serving.

=== 1. DETECT FOOD ===

Determine whether the image contains an identifiable food or drink.

If the image is NOT food or drink (for example: person, animal, pet, vehicle, object, scenery, screenshot, furniture, etc.), return:

{
  "foodName": "Not Food",
  "foodNameMalay": "",
  "calories": 0,
  "protein": 0,
  "carbs": 0,
  "fat": 0,
  "fiber": 0,
  "servingSize": "N/A",
  "confidence": 1.0,
  "category": "${foodOptions.defaults.category}",
  "type": "${foodOptions.defaults.healthType}",
  "description": "This image does not contain food or a drink."
}

=== 2. IDENTIFY THE FOOD ===

Identify the MOST SPECIFIC food or meal that can reasonably be determined from the image.

Do NOT use overly generic names when the dish can be identified.

GOOD:
- "Nasi Lemak with Fried Chicken and Egg"
- "Chicken Fried Rice"
- "Mee Goreng with Chicken"
- "Roti Canai with Dhal Curry"
- "Grilled Chicken with Rice and Vegetables"
- "Pepperoni Pizza"

BAD:
- "Rice"
- "Noodles"
- "Chicken"
- "Food"
- "Meal"

If several foods are visible together, describe them as one complete meal.

Only identify ingredients that are actually visible or strongly supported by the appearance.
Do not invent ingredients that cannot reasonably be determined.

=== 3. MALAYSIAN FOOD ===

If the food is Malaysian or commonly eaten in Malaysia:

- foodName = English description of the food
- foodNameMalay = Malay/local food name

Examples:

"Nasi Lemak with Fried Chicken and Egg"
"Nasi Lemak dengan Ayam Goreng dan Telur"

"Mee Goreng"
"Mee Goreng"

"Roti Canai with Dhal Curry"
"Roti Canai dengan Kuah Dal"

For non-Malaysian food:
- foodName = English name
- foodNameMalay = ""

${buildCategoryPromptSection(foodOptions)}

${buildHealthTypePromptSection(foodOptions)}

=== 6. PORTION SIZE ===

Estimate the ACTUAL visible serving.

Use realistic descriptions such as:
- "1 plate (400g)"
- "1 bowl (350g)"
- "2 pieces (180g)"
- "1 cup (300ml)"
- "2 slices (220g)"
- "1 serving (250g)"

Consider the amount of food visible in the image.

Do not assume a standard restaurant serving if the image clearly shows a smaller or larger portion.

=== 7. NUTRITION ESTIMATION ===

Estimate the TOTAL nutrition for the visible serving:

- calories = kcal
- protein = grams
- carbs = grams
- fat = grams
- fiber = grams

Consider:
- Portion size
- Visible ingredients
- Cooking method
- Rice/noodle quantity
- Meat quantity
- Eggs
- Oil
- Coconut milk
- Cheese
- Sauces
- Gravy
- Sugar
- Fried components

Use realistic estimates.

Do not pretend that image analysis can determine exact nutrition.

Round nutrition values to sensible numbers.

For example:
GOOD: 650 calories
AVOID: 647.382 calories

The nutrition values should be internally reasonable.

Calories should generally be consistent with the estimated protein, carbohydrate, and fat.

Use:
approximately 4 kcal/g for protein
approximately 4 kcal/g for carbohydrates
approximately 9 kcal/g for fat

Fiber may contribute additional calories but does not need to be calculated exactly.

=== 8. CONFIDENCE ===

confidence represents confidence in the food identification AND nutrition estimate.

Use:

0.90 - 1.00
Food is clearly identifiable and portion is reasonably clear.

0.75 - 0.89
Food is identifiable but ingredients or portion have some uncertainty.

0.50 - 0.74
Food is reasonably guessed but there is significant uncertainty.

0.00 - 0.49
Food identification is highly uncertain.

If uncertain, still provide your best reasonable estimate and reduce confidence.

Do NOT use high confidence when the food cannot be clearly identified.

=== 9. DESCRIPTION ===

Write ONE short sentence describing the visible food.

Mention the main visible components.

Do not repeat the nutrition information.

=== OUTPUT ===

Return ONLY this JSON:

{
  "foodName": "specific English food name",
  "foodNameMalay": "Malay/local name or empty string",
  "calories": 0,
  "protein": 0,
  "carbs": 0,
  "fat": 0,
  "fiber": 0,
  "servingSize": "realistic serving estimate",
  "confidence": 0.0,
  "category": "${foodOptions.categories[0].name}",
  "type": "${foodOptions.healthTypes[0].name}",
  "description": "Brief description of the visible food."
}

${buildAllowedValuesPromptSection(foodOptions)}`;

    const body = {
      contents: [{
        parts: [
          { text: prompt },
          {
            inline_data: {
              mime_type: 'image/jpeg',
              data: imageBase64
            }
          }
        ]
      }],
      generationConfig: {
        temperature: 0.4,
        topK: 32,
        topP: 1,
        maxOutputTokens: 2048,
      }
    };

    // Stop queueing / retrying once the client has gone away.
    const abort = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) abort.abort();
    });

    const manager = await getModelManager();

    try {
      // validate: parse + normalize the AI reply; unusable replies are retried on another model.
      const { result: food, model, attempts } = await manager.execute(body, {
        signal: abort.signal,
        validate: toFoodAnalysis,
      });
      logger.success(`Food scan completed with ${model} (attempts: ${attempts}) for user: ${req.user.uid} -> ${food.analysis.category}`);
      if (process.env.DEBUG_AI_RESPONSE === 'true') logAiResponse(model, food);

      return res.json({
        success: true,
        data: toAppGeminiShape(food), // same shape the app parses, with cleaned values
        analysis: food.analysis,      // clean object for future clients
        model,
      });
    } catch (error) {
      if (!(error instanceof ModelManagerError)) throw error;
      if (error.code === 'ABORTED') return; // client disconnected; nothing to send

      if (error.retryAfterMs != null) {
        res.set('Retry-After', String(Math.ceil(error.retryAfterMs / 1000)));
      }
      logger.error(`Food scan failed for user ${req.user.uid}: ${error.code}${error.cause ? ` (${error.cause.message})` : ''}`);
      return res.status(error.httpStatus).json({
        error: error.title,
        code: error.code,
        message: error.message,
        ...(error.retryAfterMs != null && { retryAfterSeconds: Math.ceil(error.retryAfterMs / 1000) }),
        ...(error.resetAt && { resetAt: error.resetAt }),
      });
    }

  } catch (error) {
    logger.error(`Scan error for user ${req.user?.uid}: ${error.stack || error.message}`);
    res.status(500).json({
      error: 'AI Food Analyzer Unavailable',
      code: 'INTERNAL',
      message: "The AI Food Analyzer couldn't analyze your photo right now. Please try again in a moment."
    });
  }
});

export default router;
