import { AIService } from "./service-parts/io";

// Pieces split into ./service-parts/ (importable on their own); re-exported for compat.
export type { SummaryOutput } from "./service-parts/types";
export { AIService } from "./service-parts/io";

export default AIService;
