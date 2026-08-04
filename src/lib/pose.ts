import type { PoseInstance, PoseModel, PosePoint, SleapInstance, SleapLabels, SleapTrack } from "./types";

export const TRACK_COLORS = ["#5b8cff", "#4ade80", "#fbbf24", "#f472b6", "#06b6d4", "#f97316", "#a855f7", "#ef4444"];

/** Picks a stable display color for a track index (-1 = untracked). */
export function trackColor(track: number): string {
  return track >= 0 ? TRACK_COLORS[track % TRACK_COLORS.length] : "#9aa4b2";
}

/** Converts one SLP instance's raw points into the SLP-free point list, dropping any point that's
 * missing, invisible, or has a non-finite coordinate. */
function instancePoints(inst: SleapInstance, nodeCount: number): (PosePoint | null)[] {
  const pts = inst.points ?? [];
  const points: (PosePoint | null)[] = [];
  for (let k = 0; k < nodeCount; k++) {
    const p = pts[k];
    points.push(
      p && p.visible && Number.isFinite(p.xy[0]) && Number.isFinite(p.xy[1])
        ? { x: p.xy[0], y: p.xy[1], score: typeof p.score === "number" ? p.score : null }
        : null,
    );
  }
  return points;
}

/** Converts a loaded SLP `Labels` object into the SLP-free pose model the rest of the app works
 * with: a skeleton, an ordered track-name list, and a per-frame instance index. */
export function labelsToPose(labels: SleapLabels): PoseModel {
  const skel = labels.skeletons.at(0);
  const nodes = skel?.nodeNames ?? [];
  const edges = skel?.edgeIndices ?? [];
  const tracks = labels.tracks.map((t) => t.name);
  const trackIdx = new Map<SleapTrack, number>(labels.tracks.map((t, i) => [t, i]));
  const byFrame = new Map<number, PoseInstance[]>();
  for (const lf of labels.labeledFrames) {
    if (!lf.instances.length) continue;
    const insts: PoseInstance[] = lf.instances.map((inst) => {
      const predicted = typeof inst.score === "number";
      return {
        track: inst.track != null ? (trackIdx.get(inst.track) ?? -1) : -1,
        kind: predicted ? "predicted" : "user",
        score: predicted ? (inst.score ?? null) : null,
        points: instancePoints(inst, nodes.length),
      };
    });
    byFrame.set(lf.frameIdx, insts);
  }
  return { skeleton: { name: skel?.name ?? "skeleton", nodes, edges }, tracks, byFrame };
}

/** Draws skeleton edges + node dots for a frame's instances onto a 2D canvas context. */
export function drawPose(
  c: CanvasRenderingContext2D,
  insts: PoseInstance[] | undefined,
  skeleton: PoseModel["skeleton"],
  width: number,
): void {
  if (!insts) return;
  for (const inst of insts) {
    const color = trackColor(inst.track);
    c.strokeStyle = color;
    c.lineWidth = Math.max(1, width / 500);
    c.globalAlpha = 0.9;
    for (const [i, j] of skeleton.edges) {
      const a = inst.points[i];
      const b = inst.points[j];
      if (a && b) {
        c.beginPath();
        c.moveTo(a.x, a.y);
        c.lineTo(b.x, b.y);
        c.stroke();
      }
    }
    c.fillStyle = color;
    const r = Math.max(2, width / 320);
    for (const p of inst.points) {
      if (!p) continue;
      c.beginPath();
      c.arc(p.x, p.y, r, 0, Math.PI * 2);
      c.fill();
    }
  }
  c.globalAlpha = 1;
}
