"""
Compare the exact and ontology matchers on the same recipe requests.

For N random recipes, the user's "pantry" is the recipe's own ingredients, named the way a person
would say them ("whole peeled tomatoes" -> "tomato"). The LLM writes these plain names once, in
batches, and they are cached in <out>/pantries.json so every run uses the same input. Each pantry
is sent to /recommend on both services, and we check where the source recipe ranks:

    Hit@1, Hit@5   source recipe is in the top 1 / top 5
    MRR@10         mean of 1/rank (0 if not in the top 10)
    empty          no recipe returned at all
    coverage       mean share of the source recipe's ingredients that were matched (from /missing)

Start the exact service next to the normal (ontology) one first:
    docker compose run -d --name recipe-exact -p 8001:8000 -e RECIPE_MATCHER=exact recipe-service
Then:
    OPENROUTER_API_KEY=... python3 eval/run_matcher_test.py
"""

import argparse
import csv
import json
import os
import random
import sys
import time
import urllib.request
from collections import defaultdict
from pathlib import Path

EVAL_DIR = Path(__file__).resolve().parent
DATA_DIR = EVAL_DIR.parent / "recipe-service" / "data" / "processed"
SERVICES = (("exact", "http://localhost:8001"), ("ontology", "http://localhost:8000"))
# Same settings as the backend (backend/src/lib/recipe-service.ts); 10 is the service's max top_k.
RECOMMEND = {"top_k": 10, "min_coverage": 0.3, "max_missing_ingredients": 4}
MIN_INGREDIENTS, MAX_INGREDIENTS = 4, 15
BATCH = 20
REWRITE_PROMPT = (
    "Below are recipes with their ingredient names as written in the recipe. For each ingredient, write "
    "how a person would name it when listing the food they have at home: a short, singular, plain English "
    "food name, like 'tomato', 'chicken thigh', 'olive oil', 'parmesan'. Drop amounts, brands and "
    "preparation words (chopped, peeled, fresh, divided). Keep one name per ingredient, in the same order. "
    'Answer only with JSON: {"<recipe id>": ["name", ...], ...}\n\n'
)


def post(url, body, headers=None, timeout=60):
    req = urllib.request.Request(url, json.dumps(body).encode(), {"Content-Type": "application/json", **(headers or {})})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def load_recipes():
    with open(DATA_DIR / "recipes.csv", newline="") as f:
        titles = {int(r["recipe_id"]): r["title"] for r in csv.DictReader(f)}
    names = defaultdict(list)
    with open(DATA_DIR / "recipe_ingredients.csv", newline="") as f:
        for r in csv.DictReader(f):
            if r["status"] != "unparsed" and r["name"].strip():
                names[int(r["recipe_id"])].append(r["name"].strip())
    return titles, names


def pick(names, n, seed):
    ids = sorted(i for i, found in names.items() if MIN_INGREDIENTS <= len(found) <= MAX_INGREDIENTS)
    return random.Random(seed).sample(ids, n)


def rewrite(batch, names, model, key):
    text = "\n".join(f"{i}: {json.dumps(names[i])}" for i in batch)
    reply = post(
        "https://openrouter.ai/api/v1/chat/completions",
        {"model": model, "temperature": 0, "response_format": {"type": "json_object"},
         "messages": [{"role": "user", "content": REWRITE_PROMPT + text}]},
        {"Authorization": f"Bearer {key}"}, timeout=180,
    )
    content = (reply["choices"][0]["message"].get("content") or "").strip().removeprefix("```json").strip("`\n ")
    try:
        return {int(k): v for k, v in json.loads(content).items() if int(k) in batch}
    except ValueError:
        print(f"  bad reply for a batch, will retry: {content[:80]!r}")
        return {}


def pantries_for(ids, names, path, model):
    cached = {int(k): v for k, v in json.loads(path.read_text()).items()} if path.exists() else {}
    todo = [i for i in ids if i not in cached]
    if todo:
        key = os.environ.get("OPENROUTER_API_KEY", "").strip()
        if not key:
            sys.exit("Set OPENROUTER_API_KEY to write the plain ingredient names (only needed once).")
        for attempt in range(3):
            todo = [i for i in ids if i not in cached]
            for start in range(0, len(todo), BATCH):
                cached = {**cached, **rewrite(todo[start:start + BATCH], names, model, key)}
                path.write_text(json.dumps({str(k): v for k, v in sorted(cached.items())}, indent=1))
                print(f"Pantries ready: {sum(i in cached for i in ids)}/{len(ids)}")
    missing = [i for i in ids if i not in cached]
    if missing:
        sys.exit(f"The LLM skipped recipes {missing}; run again to fill them in.")
    return {i: cached[i] for i in ids}


def evaluate(base, recipe_id, pantry):
    start = time.time()
    found = post(base + "/recommend", {"available_ingredients": pantry, **RECOMMEND})["recipes"]
    seconds = time.time() - start
    ranked = [r["recipe_id"] for r in found]
    rank = ranked.index(recipe_id) + 1 if recipe_id in ranked else None
    missing = post(base + "/missing", {"recipe_id": recipe_id, "available_ingredients": pantry})
    total = len(missing["matched"]) + len(missing["missing"])
    return {"rank": rank, "returned": len(ranked), "coverage": len(missing["matched"]) / total if total else 0.0,
            "seconds": seconds}


def summarize(rows):
    n = len(rows)
    ranks = [r["rank"] for r in rows]
    return {
        "Hit@1": sum(r == 1 for r in ranks) / n,
        "Hit@5": sum(r is not None and r <= 5 for r in ranks) / n,
        "MRR@10": sum(1 / r for r in ranks if r) / n,
        "empty": sum(r["returned"] == 0 for r in rows) / n,
        "coverage": sum(r["coverage"] for r in rows) / n,
        "ms": 1000 * sum(r["seconds"] for r in rows) / n,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--n", type=int, default=200)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--model", default=os.environ.get("OPENROUTER_MODEL", "deepseek/deepseek-v4.1-flash"))
    parser.add_argument("--out", type=Path, default=EVAL_DIR / "results")
    args = parser.parse_args()

    titles, names = load_recipes()
    ids = pick(names, args.n, args.seed)
    args.out.mkdir(parents=True, exist_ok=True)
    pantries = pantries_for(ids, names, args.out / "pantries.json", args.model)

    rows = []
    for i in ids:
        row = {"recipe_id": i, "title": titles.get(i, ""), "pantry": ";".join(pantries[i])}
        for label, base in SERVICES:
            result = evaluate(base, i, pantries[i])
            row.update({f"{label}_{k}": v for k, v in result.items()})
        rows.append(row)

    with open(args.out / "matcher_results.csv", "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)

    print(f"\n{len(rows)} recipes, seed {args.seed}")
    print(f"{'matcher':<10}" + "".join(f"{k:>10}" for k in ("Hit@1", "Hit@5", "MRR@10", "empty", "coverage", "ms")))
    for label, _ in SERVICES:
        s = summarize([{k.removeprefix(label + "_"): v for k, v in r.items() if k.startswith(label + "_")} for r in rows])
        print(f"{label:<10}" + "".join(f"{v:>10.1f}" if k == "ms" else f"{v:>10.3f}" for k, v in s.items()))
    print(f"Saved {args.out / 'matcher_results.csv'}")


if __name__ == "__main__":
    main()
