import { IAIProvider } from './IAIProvider';

export class AIProviderRegistry {
  private providers: Map<string, IAIProvider> = new Map();

  register(provider: IAIProvider): void {
    this.providers.set(provider.id, provider);
  }

  get(id: string): IAIProvider | undefined {
    return this.providers.get(id);
  }

  list(): IAIProvider[] {
    return Array.from(this.providers.values());
  }
}
