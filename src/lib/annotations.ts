import type { AnnotationsDocument, AnnotationsFrameOut, PoseModel } from "./types";

export interface ClipDescriptor {
  sourceName: string;
  sourceUrl: string | null;
  originalFilename: string | null;
  author: string | null;
  fps: number;
  width: number;
  height: number;
}

/** Builds the SLP-free, clip-relative annotations document for the given frame range
 * (inclusive), re-indexing each labeled frame's `clip_frame` from 0 within the selection. */
export function buildAnnotations(pose: PoseModel | null, lo: number, hi: number, clip: ClipDescriptor): AnnotationsDocument {
  const frames: AnnotationsFrameOut[] = [];
  if (pose) {
    for (let f = lo; f <= hi; f++) {
      const insts = pose.byFrame.get(f);
      if (!insts || !insts.length) continue;
      frames.push({
        clip_frame: f - lo,
        source_frame: f,
        instances: insts.map((inst) => ({
          track: inst.track >= 0 ? inst.track : null,
          track_name: inst.track >= 0 ? pose.tracks[inst.track] : null,
          kind: inst.kind,
          score: inst.score,
          points: inst.points.map((p, k) =>
            p
              ? { node: pose.skeleton.nodes[k], xy: [p.x, p.y] as [number, number], visible: true, score: p.score }
              : { node: pose.skeleton.nodes[k], xy: null, visible: false, score: null },
          ),
        })),
      });
    }
  }
  return {
    format: "sleap-clip-annotations/v1",
    clip: {
      source: clip.sourceName,
      source_url: clip.sourceUrl,
      original_filename: clip.originalFilename,
      author: clip.author,
      in_frame: lo,
      out_frame: hi,
      num_frames: hi - lo + 1,
      fps: clip.fps,
      width: clip.width,
      height: clip.height,
      extracted_at: new Date().toISOString(),
    },
    skeleton: pose ? { name: pose.skeleton.name, nodes: pose.skeleton.nodes, edges: pose.skeleton.edges } : null,
    tracks: pose ? pose.tracks : [],
    labeled_frame_count: frames.length,
    frames,
  };
}

/** Counts labeled frames from `pose` that fall inside [lo, hi] — used for the "N labeled frames
 * in selection" summary without building the full annotations document. */
export function countLabeledFramesInRange(pose: PoseModel | null, lo: number, hi: number): number {
  if (!pose) return 0;
  let n = 0;
  for (let f = lo; f <= hi; f++) {
    const insts = pose.byFrame.get(f);
    if (insts && insts.length) n++;
  }
  return n;
}
