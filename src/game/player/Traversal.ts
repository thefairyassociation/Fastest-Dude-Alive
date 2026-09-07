/** Shared, allocation-free traversal math; values use metres and seconds. */
export const JUMP_BUFFER_SECONDS = 0.14;
export const COYOTE_SECONDS = 0.12;

/** A bounded angular step also works for an exactly opposite stick direction. */
export function turnHeading(current: number, target: number, maximumStep: number): number {
  const difference = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  return current + Math.max(-maximumStep, Math.min(maximumStep, difference));
}

/** Solves distance = downwardSpeed * t + gravity * t² / 2. */
export function timeToLanding(height: number, verticalSpeed: number, gravity: number): number {
  if (height < 0 || verticalSpeed > 0) return Infinity;
  return (verticalSpeed + Math.sqrt(verticalSpeed * verticalSpeed + 2 * gravity * height)) / gravity;
}
