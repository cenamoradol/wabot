export interface EventPublisher {
  publish(businessId: string, event: { type: string; id: string }): Promise<void>;
}

export class MemoryEventPublisher implements EventPublisher {
  readonly events: Array<{ businessId: string; type: string; id: string }> = [];
  async publish(businessId: string, event: { type: string; id: string }) {
    this.events.push({ businessId, ...event });
  }
}
