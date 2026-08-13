"""Regenerates the `.nwb` pose fixtures next to this script.

    pip install h5py numpy && python tests/fixtures/make_nwb_fixtures.py

The files are minimal hand-built ndx-pose `PoseEstimation` (predictions) layouts — the containers
and attributes sleap-io.js's reader actually walks, and nothing else — so they stay a few tens of
kilobytes rather than the multi-megabyte export a real recording would produce. Writing them by
hand also keeps pynwb out of the toolchain: nothing here is validated against the ndx-pose schema,
only against what the reader and `src/lib/nwb.ts` look for.

Each series is dense (one sample per video frame) with frame numbers stored as timestamps, which is
what sleap-io.js's own NWB writer produces.
"""

from pathlib import Path

import h5py
import numpy as np

NODES = ["nose", "body", "tail"]
EDGES = np.array([[0, 1], [1, 2]], dtype="int32")
STRING = h5py.special_dtype(vlen=str)


def write_predictions(path: Path, samples: int, video: str, tracks: tuple[str, ...] = ("mouse1",)) -> None:
    """One PoseEstimation group per track, one PoseEstimationSeries per node, `samples` long."""
    with h5py.File(path, "w") as f:
        f.attrs["nwb_version"] = "2.7.0"
        f.attrs["neurodata_type"] = "NWBFile"
        f.create_group("general")

        behavior = f.create_group("processing/behavior")
        behavior.attrs["neurodata_type"] = "ProcessingModule"

        skeletons = behavior.create_group("Skeletons")
        skeletons.attrs["neurodata_type"] = "Skeletons"
        skeleton = skeletons.create_group("Skeleton")
        skeleton.attrs["neurodata_type"] = "Skeleton"
        skeleton.create_dataset("nodes", data=np.array(NODES, dtype=STRING))
        skeleton.create_dataset("edges", data=EDGES)

        for track in tracks:
            pose = behavior.create_group(f"track={track}")
            pose.attrs["neurodata_type"] = "PoseEstimation"
            pose.create_dataset("original_videos", data=np.array([video], dtype=STRING))
            for node_index, node in enumerate(NODES):
                series = pose.create_group(node)
                series.attrs["neurodata_type"] = "PoseEstimationSeries"
                # A diagonal walk across the frame, offset per node so the skeleton is visible.
                xy = np.stack(
                    [
                        np.arange(samples, dtype="float64") + node_index * 10,
                        np.arange(samples, dtype="float64") + node_index * 10,
                    ],
                    axis=1,
                )
                series.create_dataset("data", data=xy)
                series.create_dataset("confidence", data=np.full(samples, 0.9))
                series.create_dataset("timestamps", data=np.arange(samples, dtype="float64"))


if __name__ == "__main__":
    here = Path(__file__).parent
    # Unit fixture (tests/unit/nwb.test.ts): just long enough to measure.
    write_predictions(here / "mice.pose.nwb", samples=8, video="mice.mp4")
    # Integration fixtures (tests/integration/nwb.spec.ts), against the ~40-frame clip the specs
    # synthesize: one that covers part of it, and one sampled over a far longer recording.
    write_predictions(here / "mice_new.pose.nwb", samples=30, video="mice_new.webm")
    write_predictions(here / "mice_long.pose.nwb", samples=200, video="mice_new.webm")
    print(f"wrote fixtures to {here}")
