export interface JobQueue {
  add(name: string, data: Record<string, unknown>, options?: { jobId?: string; attempts?: number; backoff?: { type: "exponential"; delay: number } }): Promise<unknown>;
}

export class MemoryJobQueue implements JobQueue {
  readonly jobs: Array<{ name: string; data: Record<string, unknown>; jobId?: string }> = [];

  async add(name: string, data: Record<string, unknown>, options?: { jobId?: string }) {
    this.jobs.push({ name, data, ...(options?.jobId ? { jobId: options.jobId } : {}) });
  }
}
