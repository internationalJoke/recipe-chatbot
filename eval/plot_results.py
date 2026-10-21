"""
Make the report figures from the test results.

    hit_at_k.pdf        Hit@k for k = 1..10, exact vs ontology matcher (from matcher_results.csv)
    photo_examples.pdf  a few test photos with the dataset labels and what the agent found

Example:
    python3 eval/plot_results.py
    python3 eval/plot_results.py --photos photo_18.jpg photo_06.jpg photo_15.jpg
"""

import argparse
import csv
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from PIL import Image

from run_photo_test import class_vocab, to_class

EVAL_DIR = Path(__file__).resolve().parent
DEFAULT_OUT = EVAL_DIR.parent / "1RT730_Project_V1"
MATCHERS = (("exact", "Exact", "#9e9e9e"), ("ontology", "Ontology", "#1f77b4"))
GOOD, BAD = "#2e7d32", "#c62828"


def read_csv(path):
    with open(path, newline="") as f:
        return list(csv.DictReader(f))


def plot_hit_at_k(rows, out):
    ks = range(1, 11)
    fig, ax = plt.subplots(figsize=(4.2, 2.8))
    for key, label, color in MATCHERS:
        ranks = [int(r[f"{key}_rank"]) for r in rows if r[f"{key}_rank"]]
        hits = [sum(rank <= k for rank in ranks) / len(rows) for k in ks]
        ax.plot(ks, hits, marker="o", markersize=4, label=label, color=color)
    ax.set_xlabel("k (recipes shown)")
    ax.set_ylabel("Hit@k")
    ax.set_xticks(list(ks))
    ax.set_ylim(0, 1)
    ax.grid(alpha=0.3)
    ax.legend(loc="lower right")
    fig.tight_layout()
    fig.savefig(out)
    plt.close(fig)


def plot_photos(rows, names, photos_dir, out):
    vocab = class_vocab()
    chosen = [r for name in names for r in rows if r["file"] == name]
    fig, axes = plt.subplots(1, len(chosen), figsize=(2.4 * len(chosen), 4.2))
    for ax, row in zip(axes, chosen):
        img = Image.open(photos_dir / row["file"])
        img.thumbnail((600, 600))
        ax.imshow(img)
        ax.set_title(row["file"].removesuffix(".jpg").replace("_", " "), fontsize=9)
        ax.set_axis_off()
        labels = row["labels"].split(";")
        found = set(row["found"].split(";")) - {""}
        truth = [(l, GOOD if l in found else BAD) for l in labels]
        # Names outside the dataset classes (yogurt, egg) cannot be checked: grey.
        agent = []
        for p in row["predicted"].split(";"):
            cls = to_class(p, vocab)
            agent.append((p, "grey" if cls is None else GOOD if cls in labels else BAD))
        for x, title, items in ((0.0, "Labels", truth), (0.55, "Agent", agent)):
            ax.text(x, -0.03, title, transform=ax.transAxes, va="top", fontsize=8, fontweight="bold")
            for i, (text, color) in enumerate(items, 1):
                ax.text(x, -0.03 - 0.075 * i, text, transform=ax.transAxes, va="top", fontsize=8, color=color)
    fig.subplots_adjust(left=0.02, right=0.98, top=0.93, bottom=0.42, wspace=0.15)
    fig.savefig(out)
    plt.close(fig)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--results", type=Path, default=EVAL_DIR / "results")
    parser.add_argument("--photos-dir", type=Path, default=EVAL_DIR / "photos")
    parser.add_argument("--photos", nargs="+", default=["photo_18.jpg", "photo_06.jpg", "photo_15.jpg"])
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = parser.parse_args()

    plot_hit_at_k(read_csv(args.results / "matcher_results.csv"), args.out / "hit_at_k.pdf")
    plot_photos(read_csv(args.results / "photo_results.csv"), args.photos, args.photos_dir, args.out / "photo_examples.pdf")
    print(f"Saved hit_at_k.pdf and photo_examples.pdf to {args.out}")


if __name__ == "__main__":
    main()
