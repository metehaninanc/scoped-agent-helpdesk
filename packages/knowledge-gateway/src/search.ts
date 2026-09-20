/**
 * Lexical search over the corpus. SPRINT3.md, 3.3: "Retrieval, in two steps... do not start with
 * embeddings... step two is embeddings, and only if step one's retrieval quality is visibly
 * insufficient on a set of real questions you write down first." This is step one, judged
 * against questions.md, not against embeddings — see the root README, "Knowledge gateway notes",
 * for the result of that comparison.
 *
 * A small, hand-rolled BM25 (Robertson/Sparck Jones) over the chunks corpus.ts produces, rather
 * than a search library: the corpus is a few dozen chunks, not a few million, and this project's
 * own style is to hand-roll something this size when a real dependency would be for one
 * algorithm it does not need to configure further (see the certificate and JWT signing in
 * @helpdesk/identity-gateway for the same call made about node:crypto).
 *
 * A query with no token in common with any chunk returns no results at all, not a low-ranked
 * top three: "if nothing relevant is retrieved, the agent says it does not know" (SPRINT3.md)
 * depends on an empty result meaning exactly that, never a guess dressed up as a citation.
 */
import type { CorpusChunk } from "./corpus.js";

export interface SearchResult {
  sourceTitle: string;
  heading: string;
  text: string;
  sourceUrl: string;
}

export interface DocumentationSearch {
  search(query: string, limit?: number): SearchResult[];
}

const DEFAULT_LIMIT = 4;
const BM25_K1 = 1.5;
const BM25_B = 0.75;

/** Words too common in ordinary English (and in this corpus's own recurring phrasing) to carry
 * any signal about what a query is actually asking. Deliberately short — a stopword wrongly kept
 * costs a little precision; a real word wrongly dropped can cost an entire query. */
const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "but", "of", "to", "in", "on", "for", "is", "are", "was", "were",
  "be", "been", "being", "with", "as", "by", "at", "from", "that", "this", "these", "those", "it",
  "its", "if", "then", "than", "so", "not", "no", "do", "does", "did", "can", "could", "should",
  "would", "will", "shall", "may", "might", "must", "have", "has", "had", "you", "your", "i", "we",
  "they", "he", "she", "what", "which", "who", "how", "when", "where", "why",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 1 && !STOPWORDS.has(token));
}

interface IndexedChunk {
  chunk: CorpusChunk;
  termCounts: Map<string, number>;
  length: number;
}

export function createDocumentationSearch(chunks: readonly CorpusChunk[]): DocumentationSearch {
  const indexed: IndexedChunk[] = chunks.map((chunk) => {
    const terms = tokenize(chunk.text);
    const termCounts = new Map<string, number>();
    for (const term of terms) termCounts.set(term, (termCounts.get(term) ?? 0) + 1);
    return { chunk, termCounts, length: terms.length };
  });

  const documentFrequency = new Map<string, number>();
  for (const { termCounts } of indexed) {
    for (const term of termCounts.keys()) documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
  }

  const totalChunks = indexed.length;
  const averageLength = totalChunks === 0 ? 0 : indexed.reduce((sum, d) => sum + d.length, 0) / totalChunks;

  const idf = (term: string): number => {
    const df = documentFrequency.get(term) ?? 0;
    if (df === 0) return 0;
    return Math.log((totalChunks - df + 0.5) / (df + 0.5) + 1);
  };

  return {
    search(query, limit = DEFAULT_LIMIT) {
      const queryTerms = [...new Set(tokenize(query))];
      if (queryTerms.length === 0) return [];

      const scored = indexed
        .map((doc) => {
          let score = 0;
          for (const term of queryTerms) {
            const frequency = doc.termCounts.get(term);
            if (!frequency) continue;
            const numerator = frequency * (BM25_K1 + 1);
            const denominator = frequency + BM25_K1 * (1 - BM25_B + (BM25_B * doc.length) / (averageLength || 1));
            score += idf(term) * (numerator / denominator);
          }
          return { doc, score };
        })
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);

      return scored.map(({ doc }) => ({
        sourceTitle: doc.chunk.sourceTitle,
        heading: doc.chunk.heading,
        text: doc.chunk.text,
        sourceUrl: doc.chunk.sourceUrl,
      }));
    },
  };
}
