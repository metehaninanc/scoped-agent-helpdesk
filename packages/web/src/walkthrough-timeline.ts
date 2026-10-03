/**
 * The frame list behind the recorded walkthrough, apart from the browser and ffmpeg that produce and
 * consume it (bin/record-walkthrough.ts). A walkthrough is a sequence of screenshots, each held on screen
 * for a number of seconds. Holding a frame longer is how a slow wait is shortened, and a frame held for
 * less than the real time it covers is how a wait is sped up; the timeline records the video's seconds, so
 * the scene list the recorder writes is the video's own clock and not the wall clock of the run.
 */
export interface Frame {
  file: string;
  /** How long the frame stays on screen in the finished video. */
  seconds: number;
  scene: string;
}

export interface SceneSpan {
  scene: string;
  startSeconds: number;
  seconds: number;
}

export class Timeline {
  private readonly frames: Frame[] = [];

  add(file: string, seconds: number, scene: string): void {
    if (!(seconds > 0)) throw new Error(`a frame must be held for a positive time, got ${seconds}`);
    this.frames.push({ file, seconds, scene });
  }

  get length(): number {
    return this.frames.length;
  }

  totalSeconds(): number {
    return this.frames.reduce((sum, f) => sum + f.seconds, 0);
  }

  /** The consecutive frames of each scene, with the video time each begins at. */
  scenes(): SceneSpan[] {
    const spans: SceneSpan[] = [];
    let clock = 0;
    for (const f of this.frames) {
      const last = spans.at(-1);
      if (last && last.scene === f.scene) last.seconds += f.seconds;
      else spans.push({ scene: f.scene, startSeconds: clock, seconds: f.seconds });
      clock += f.seconds;
    }
    return spans;
  }

  /**
   * An ffmpeg concat-demuxer script. The demuxer ignores the duration of the last entry unless that file
   * is listed once more, so the final frame is repeated.
   */
  concatList(): string {
    if (this.frames.length === 0) throw new Error("no frames to encode");
    const quote = (file: string): string => `'${file.replace(/\\/g, "/").replace(/'/g, "'\\''")}'`;
    const lines = this.frames.flatMap((f) => [`file ${quote(f.file)}`, `duration ${f.seconds.toFixed(3)}`]);
    lines.push(`file ${quote(this.frames.at(-1)!.file)}`);
    return lines.join("\n") + "\n";
  }
}

/** 4:07 for 247 seconds. */
export function mmss(seconds: number): string {
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
