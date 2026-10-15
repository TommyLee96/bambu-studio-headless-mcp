# SPDX-License-Identifier: GPL-2.0-only
"""Generate two original, closed ASCII STL cubes in shared assembly coordinates.

Run: python examples/make_sample_parts.py --output-dir artifacts/demo
The cubes are 8 mm wide with a 4 mm gap. This script needs only Python's standard
library; it contains no vendor settings or downloaded/user-owned geometry.
"""
import argparse
from pathlib import Path


def cube_stl(x=0.0, size=8.0):
    vertices = [(x + dx * size, dy * size, dz * size)
                for dz in (0, 1) for dy in (0, 1) for dx in (0, 1)]
    faces = [(0, 2, 3), (0, 3, 1), (4, 5, 7), (4, 7, 6),
             (0, 1, 5), (0, 5, 4), (2, 6, 7), (2, 7, 3),
             (0, 4, 6), (0, 6, 2), (1, 3, 7), (1, 7, 5)]
    lines = ["solid bridge_demo"]
    for face in faces:
        lines += ["  facet normal 0 0 0", "    outer loop"]
        lines += ["      vertex " + " ".join(format(v, ".12g") for v in vertices[index]) for index in face]
        lines += ["    endloop", "  endfacet"]
    return "\n".join(lines + ["endsolid bridge_demo", ""])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    targets = [args.output_dir / f"part_{slot}.stl" for slot in (1, 2)]
    if any(p.exists() for p in targets):
        parser.exit(1, "Refusing to overwrite existing example parts\n")
    for path, x in zip(targets, (0.0, 12.0)):
        with path.open("x", encoding="ascii") as stream:
            stream.write(cube_stl(x=x))
        print(path)


if __name__ == "__main__":
    main()
