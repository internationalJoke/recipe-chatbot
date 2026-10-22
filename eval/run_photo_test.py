"""
Send each test photo to the running chatbot and score the ingredients it finds.

For every photo in <photos>/labels.csv the script opens a new conversation, sends the photo with
PROMPT, and reads the ingredient list the model passed to the suggestDishes tool (saved on each
dish as "available"). It then compares that list with the dataset labels:

    recall    = labelled ingredients found / labelled ingredients
    precision = correct names / names that are dataset classes   (closed set: the dataset only
                labels 63 fruits and vegetables, so other names like "yogurt" are not counted)

Writes <out>/photo_results.csv (one row per photo) and prints a summary.

Example:
    python3 eval/run_photo_test.py
    python3 eval/run_photo_test.py --only photo_01.jpg --keep
"""

import argparse
import csv
import json
import re
import sys
import time
import urllib.request
import uuid
from pathlib import Path

from sample_photos import fetch

EVAL_DIR = Path(__file__).resolve().parent
PROMPT = "Here is a photo of the food I have at home. What can I cook with it?"
# Common names the model may use for a dataset class.
ALIASES = {
    "kiwi": "kiwi fruit", "kiwifruit": "kiwi fruit", "mandarin": "mandarin orange", "tangerine": "mandarin orange",
    "capsicum": "bell pepper", "pepper": "bell pepper", "sweet pepper": "bell pepper",
    "scallion": "green onion", "spring onion": "green onion", "shallot": "onion",
    "courgette": "zucchini", "aubergine": "eggplant", "tofu": "bean curd", "garbanzo": "chickpea",
    "cherry tomato": "tomato", "rocket": "lettuce", "arugula": "lettuce", "spinach": "lettuce",
    "salad": "lettuce", "mixed green": "lettuce", "romaine": "lettuce",
}


def singular(word):
    word = word.strip().lower()
    for end, repl in (("ies", "y"), ("oes", "o"), ("ches", "ch"), ("s", "")):
        if word.endswith(end) and not word.endswith("ss") and len(word) > 3:
            return word[: -len(end)] + repl
    return word


def class_vocab():
    """Every name in the dataset's data.yaml -> its class (first name), plus ALIASES."""
    vocab = {}
    for line in fetch("data.yaml").decode().splitlines():
        m = re.match(r"\s+\d+: (.+)", line)
        if m:
            names = [singular(n) for n in m[1].split("/")]
            for n in names:
                vocab.setdefault(n, names[0])
    return {**vocab, **{singular(k): singular(v) for k, v in ALIASES.items()}}


def to_class(name, vocab):
    """Map a predicted name to a dataset class, trying the longest ending first
    ("red bell peppers" -> "bell pepper", "green grapes" -> "grape")."""
    words = singular(name).split()
    for i in range(len(words)):
        tail = " ".join(words[i:])
        if tail in vocab:
            return vocab[tail]
    return None


def request(method, url, body=None, headers=None, timeout=300):
    req = urllib.request.Request(url, data=body, method=method, headers=headers or {})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def ask(api, photo):
    """Send one photo in a new conversation. Returns (conversation id, final event, seconds, dish tool)."""
    conv = json.loads(request("POST", f"{api}/conversations", b"{}", {"Content-Type": "application/json"}))
    boundary = uuid.uuid4().hex
    body = (
        f'--{boundary}\r\nContent-Disposition: form-data; name="content"\r\n\r\n{PROMPT}\r\n'
        f'--{boundary}\r\nContent-Disposition: form-data; name="files"; filename="{photo.name}"\r\n'
        f"Content-Type: image/jpeg\r\n\r\n"
    ).encode() + photo.read_bytes() + f"\r\n--{boundary}--\r\n".encode()
    start = time.time()
    raw = request("POST", f"{api}/conversations/{conv['id']}/messages", body,
                  {"Content-Type": f"multipart/form-data; boundary={boundary}"})
    events = [json.loads(l) for l in raw.decode().splitlines() if l.strip()]
    final = next((e for e in reversed(events) if e.get("type") in ("done", "error")), {"type": "error", "error": "no reply"})
    return conv["id"], final, time.time() - start, dish_tool(events)


def dish_tool(events):
    """Who called suggestDishes: "model", "forced" (the backend's safety net), or "none"."""
    calls = [e for e in events if e.get("type") == "status" and e.get("status") == "dishes"]
    if any(not e.get("forced") for e in calls):
        return "model"
    return "forced" if calls else "none"


def found_ingredients(final, vocab):
    """The list sent to suggestDishes, read from the dish cards. When no recipe matched there are no
    cards, so fall back to the dataset class names in the reply's first paragraph ("I can see ...");
    later paragraphs suggest things to buy, which the model did not see."""
    message = final.get("assistantMessage") or {}
    dishes = message.get("dishes") or []
    if dishes:
        return dishes[0].get("available", []), "tool"
    first = (message.get("content") or "").strip().split("\n\n")[0]
    text = " ".join(singular(w) for w in re.findall(r"[a-z]+", first.lower()))
    mentioned = [name for name in vocab if re.search(rf"\b{re.escape(name)}\b", text)]
    return mentioned, "text"


def score(truth, predicted, vocab):
    mapped = {p: to_class(p, vocab) for p in predicted}
    in_set = [c for c in mapped.values() if c]
    hits = truth & set(in_set)
    recall = len(hits) / len(truth) if truth else 0.0
    precision = sum(c in truth for c in in_set) / len(in_set) if in_set else None
    return hits, recall, precision


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--api", default="http://localhost:3100/api")
    parser.add_argument("--photos", type=Path, default=EVAL_DIR / "photos")
    parser.add_argument("--out", type=Path, default=EVAL_DIR / "results")
    parser.add_argument("--only", nargs="*", help="photo file names to run (default: all)")
    parser.add_argument("--keep", action="store_true", help="keep the test conversations in the app")
    args = parser.parse_args()

    try:
        health = json.loads(request("GET", f"{args.api}/health"))
    except urllib.error.HTTPError as e:
        health = json.loads(e.read() or b"{}")
    if health.get("llm") != "ok":
        sys.exit(f"LLM is not ready: {health}")
    print(f"Model: {health['provider']} / {health['model']}")

    vocab = class_vocab()
    with open(args.photos / "labels.csv") as f:
        rows = [r for r in csv.DictReader(f) if not args.only or r["file"] in args.only]

    args.out.mkdir(parents=True, exist_ok=True)
    results = []
    for r in rows:
        truth = {singular(t) for t in r["ingredients"].split(";")}
        conv_id, final, secs, tool = ask(args.api, args.photos / r["file"])
        predicted, source = found_ingredients(final, vocab)
        hits, recall, precision = score(truth, predicted, vocab)
        results.append({
            "file": r["file"], "labels": ";".join(sorted(truth)), "predicted": ";".join(predicted), "source": source, "dish_tool": tool,
            "found": ";".join(sorted(hits)), "missed": ";".join(sorted(truth - hits)),
            "recall": round(recall, 3), "precision": "" if precision is None else round(precision, 3),
            "recipes": len((final.get("assistantMessage") or {}).get("dishes") or []),
            "seconds": round(secs, 1), "error": final.get("error", ""),
        })
        print(f"{r['file']}: recall {recall:.2f}  found {sorted(hits)}  missed {sorted(truth - hits)}  "
              f"predicted {predicted}  tool {tool}  {secs:.0f}s {final.get('error', '')}")
        if not args.keep:
            request("DELETE", f"{args.api}/conversations/{conv_id}")

    with open(args.out / "photo_results.csv", "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(results[0]))
        writer.writeheader()
        writer.writerows(results)

    precisions = [r["precision"] for r in results if r["precision"] != ""]
    print(f"\nPhotos: {len(results)}  model: {health['model']}")
    print(f"Mean recall:    {sum(r['recall'] for r in results) / len(results):.3f}")
    print(f"Mean precision: {sum(precisions) / len(precisions):.3f}" if precisions else "Mean precision: n/a")
    print(f"No ingredients: {sum(not r['predicted'] for r in results)}")
    print(f"No recipe found: {sum(r['recipes'] == 0 for r in results)}")
    for who in ("model", "forced", "none"):
        print(f"suggestDishes {who}: {sum(r['dish_tool'] == who for r in results)}")
    print(f"Mean latency:   {sum(r['seconds'] for r in results) / len(results):.1f}s")
    print(f"Saved {args.out / 'photo_results.csv'}")


if __name__ == "__main__":
    main()
