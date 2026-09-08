/** A session-only free-roam challenge. No scoring during races or story beats. */
export class MomentumRun {
  score = 0;
  best = 0;
  multiplier = 1;
  grace = 2.5;
  active = false;
  private readonly styles = new Set<string>();
  private rewarded = 0;

  get progress(): number { return (this.score % 600) / 600; }

  reset(): void {
    this.score = 0;
    this.multiplier = 1;
    this.grace = 2.5;
    this.active = false;
    this.styles.clear();
    this.rewarded = 0;
  }

  /** Returns earned energy, once per 600 points. Distance is bounded to real motion. */
  update(dt: number, speed: number, distance: number, state: string, interrupted = false): number {
    if (interrupted) { this.best = Math.max(this.best, this.score); this.reset(); return 0; }
    if (speed < 40 || distance <= 0) {
      if (this.active) {
        this.grace = Math.max(0, this.grace - dt);
        if (this.grace === 0) { this.best = Math.max(this.best, this.score); this.reset(); }
      }
      return 0;
    }
    this.active = true;
    this.grace = 2.5;
    this.styles.add(state);
    this.multiplier = Math.min(4, this.styles.size);
    this.score += Math.min(distance, speed * dt * 1.1) * this.multiplier;
    this.best = Math.max(this.best, this.score);
    const earned = Math.floor(this.score / 600);
    const charge = (earned - this.rewarded) * 12;
    this.rewarded = earned;
    return charge;
  }
}
