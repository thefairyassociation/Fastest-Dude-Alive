import { AbstractEngine, Engine, WebGPUEngine } from "@babylonjs/core";

export type RendererKind = "WebGPU" | "WebGL 2";

export interface EngineResult {
  engine: AbstractEngine;
  renderer: RendererKind;
}

export async function createBestEngine(canvas: HTMLCanvasElement): Promise<EngineResult> {
  if (await WebGPUEngine.IsSupportedAsync) {
    try {
      const engine = new WebGPUEngine(canvas, {
        antialias: true,
        adaptToDeviceRatio: true,
      });
      await engine.initAsync();
      tuneResolution(engine);
      return { engine, renderer: "WebGPU" };
    } catch (error) {
      console.warn("WebGPU initialization failed; falling back to WebGL.", error);
    }
  }

  const engine = new Engine(
    canvas,
    true,
    {
      adaptToDeviceRatio: true,
      preserveDrawingBuffer: false,
      stencil: true,
      powerPreference: "high-performance",
    },
    true,
  );
  tuneResolution(engine);
  return { engine, renderer: "WebGL 2" };
}

function tuneResolution(engine: AbstractEngine): void {
  const ratio = window.devicePixelRatio || 1;
  engine.setHardwareScalingLevel(Math.max(1, ratio / 1.5));
}
