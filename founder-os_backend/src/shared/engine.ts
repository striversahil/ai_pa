import { logger } from './logger';

export interface AnalysisEngine {
  name: string;
  runSync(): Promise<any>;
  getBriefingContext(): Promise<string>;
  getEodContext(): Promise<string>;
}

export class EngineRegistry {
  private static engines: Map<string, AnalysisEngine> = new Map();

  /**
   * Registers a new analysis engine
   */
  static register(key: string, engine: AnalysisEngine) {
    logger.info(`EngineRegistry: Registering engine "${engine.name}" (key: ${key})`);
    this.engines.set(key, engine);
  }

  /**
   * Fetches a registered engine by key
   */
  static get(key: string): AnalysisEngine | undefined {
    return this.engines.get(key);
  }

  /**
   * Returns all active registered engines
   */
  static getEngines(): AnalysisEngine[] {
    return Array.from(this.engines.values());
  }
}
