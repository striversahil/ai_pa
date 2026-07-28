import { config } from '../../config';
import { logger } from '../../shared/logger';

export class BrainEmbedder {
  private static HF_ROUTER_URL = 'https://router.huggingface.co/hf-inference/models/sentence-transformers/all-MiniLM-L6-v2/pipeline/feature-extraction';

  /**
   * Generates embeddings for a batch of texts using Hugging Face Router Pipeline API.
   * Automatically handles model loading retries and batching.
   */
  static async getEmbeddings(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    if (!config.HF_API_KEY) {
      logger.warn('BrainEmbedder: HF_API_KEY not configured. Returning zero vectors.');
      return texts.map(() => new Array(384).fill(0));
    }

    const maxRetries = 5;
    let attempt = 0;
    let delay = 3000; // start with 3s delay

    while (attempt < maxRetries) {
      try {
        const response = await fetch(this.HF_ROUTER_URL, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${config.HF_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            inputs: texts,
          }),
        });

        if (!response.ok) {
          const textErr = await response.text();
          let jsonErr: any;
          try {
            jsonErr = JSON.parse(textErr);
          } catch {
            // Not JSON
          }

          // Handle model loading or rate limits
          if (response.status === 503 || (jsonErr && jsonErr.error && jsonErr.error.includes('loading'))) {
            logger.info(`BrainEmbedder: HuggingFace model is loading/unavailable (Status: ${response.status}). Waiting ${delay / 1000}s (Attempt ${attempt + 1}/${maxRetries})...`);
            await new Promise((resolve) => setTimeout(resolve, delay));
            attempt++;
            delay *= 1.5;
            continue;
          }

          throw new Error(`HuggingFace Router API HTTP error! Status: ${response.status}. Error: ${textErr}`);
        }

        const data = await response.json();
        
        // Pipeline API returns a 2D array: number[][]
        if (Array.isArray(data)) {
          if (Array.isArray(data[0])) {
            return data as number[][];
          } else if (typeof data[0] === 'number') {
            // Single input response format (1D array)
            return [data] as number[][];
          }
        }

        throw new Error(`Unexpected HuggingFace Router response format: ${JSON.stringify(data)}`);
      } catch (err: any) {
        logger.error({ error: err.message, attempt: attempt + 1 }, 'BrainEmbedder: API call failed');
        attempt++;
        if (attempt >= maxRetries) {
          throw err;
        }
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay *= 2; // exponential backoff
      }
    }

    throw new Error('BrainEmbedder: Max retries exceeded');
  }

  /**
   * Generates a single embedding for a query text.
   */
  static async getEmbedding(text: string): Promise<number[]> {
    const res = await this.getEmbeddings([text]);
    return res[0];
  }
}
