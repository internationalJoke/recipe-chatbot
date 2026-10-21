"""
Pick random raw-ingredient photos from the LVIS Fruits and Vegetables test set and download them.

The test set (180 manually labelled photos, YOLO labels, Apache-2.0) is on Hugging Face:
https://huggingface.co/datasets/henningheyen/LVIS_Fruits_And_Vegetables

Writes <out>/<photo>.jpg and <out>/labels.csv (file, ingredients joined by ";", boxes).

Examples:
    python3 eval/sample_photos.py --n 20                      # random pick
    python3 eval/sample_photos.py --only eval/photo_list.txt  # our 20 hand-picked raw-ingredient photos
"""

import argparse
import csv
import json
import random
import re
import sys
import urllib.parse
import urllib.request
from pathlib import Path

DATASET = "henningheyen/LVIS_Fruits_And_Vegetables"
BASE_URL = f"https://huggingface.co/datasets/{DATASET}/resolve/main/"
API_URL = f"https://huggingface.co/api/datasets/{DATASET}"
DEFAULT_OUT = Path(__file__).resolve().parent / "photos"


def fetch(path):
    url = BASE_URL + urllib.parse.quote(path)
    try:
        with urllib.request.urlopen(url, timeout=60) as r:
            return r.read()
    except OSError as e:
        sys.exit(f"Download failed for {path}: {e}")


def class_names():
    """Class id -> first name in data.yaml ("bell pepper/capsicum" -> "bell pepper")."""
    names = {}
    for line in fetch("data.yaml").decode().splitlines():
        m = re.match(r"\s+(\d+): (.+)", line)
        if m:
            names[int(m[1])] = m[2].split("/")[0].strip().lower()
    return names


def test_photos():
    with urllib.request.urlopen(API_URL, timeout=60) as r:
        files = [s["rfilename"] for s in json.load(r)["siblings"]]
    # The repo has one stray "images/test/ .jpg" without a label file.
    return sorted(f for f in files if f.startswith("images/test/") and f.endswith(".jpg") and Path(f).stem.strip())


def labels_for(image_path, names):
    label_path = "labels/test/" + Path(image_path).stem + ".txt"
    lines = fetch(label_path).decode().splitlines()
    return [names[int(l.split()[0])] for l in lines if l.strip()]


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--n", type=int, default=20)
    parser.add_argument("--min-kinds", type=int, default=2, help="min different ingredients per photo")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--only", type=Path, help="text file with the photo paths to use, instead of a random pick")
    args = parser.parse_args()

    names = class_names()
    if args.only:
        chosen = [l.strip() for l in args.only.read_text().splitlines() if l.strip()]
        labelled = {p: labels_for(p, names) for p in chosen}
    else:
        labelled = {p: labels_for(p, names) for p in test_photos()}
        candidates = sorted(p for p, found in labelled.items() if len(set(found)) >= args.min_kinds)
        if len(candidates) < args.n:
            sys.exit(f"Only {len(candidates)} photos with {args.min_kinds}+ ingredients, asked for {args.n}.")
        chosen = random.Random(args.seed).sample(candidates, args.n)

    args.out.mkdir(parents=True, exist_ok=True)
    with open(args.out / "labels.csv", "w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["file", "ingredients", "boxes"])
        for i, path in enumerate(chosen, 1):
            name = f"photo_{i:02d}.jpg"
            (args.out / name).write_bytes(fetch(path))
            found = labelled[path]
            writer.writerow([name, ";".join(sorted(set(found))), len(found)])
    print(f"Saved {len(chosen)} photos to {args.out}")


if __name__ == "__main__":
    main()
