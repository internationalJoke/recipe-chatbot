"""
Send the same requests to two recipe services and print the results side by side.

Start the second service with the original matching first:
    docker compose run -d --name recipe-exact -p 8001:8000 -e RECIPE_MATCHER=exact recipe-service
Then:
    python3 recipe-service/scripts/compare_matchers.py "tomato, egg, onion, garlic, olive oil"
    python3 recipe-service/scripts/compare_matchers.py "tomato, garlic, onion, olive oil" --recipe 1733
"""

import argparse
import json
import urllib.request

SERVICES = (("exact", "http://localhost:8001"), ("ontology", "http://localhost:8000"))


def post(base, path, body):
    request = urllib.request.Request(base + path, json.dumps(body).encode(), {"Content-Type": "application/json"})
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("ingredients", help='comma-separated, e.g. "tomato, egg, onion"')
    parser.add_argument("--recipe", type=int, help="show /missing for this recipe id instead of /recommend")
    parser.add_argument("--top", type=int, default=3)
    args = parser.parse_args()
    have = [x.strip() for x in args.ingredients.split(",") if x.strip()]

    for label, base in SERVICES:
        print(f"\n== {label} ({base})")
        if args.recipe is not None:
            result = post(base, "/missing", {"recipe_id": args.recipe, "available_ingredients": have})
            print(f"{result['recipe_name']}\n  matched: {result['matched']}\n  missing: {result['missing']}")
            continue
        body = {"available_ingredients": have, "top_k": args.top, "min_coverage": 0.3, "max_missing_ingredients": 4}
        for recipe in post(base, "/recommend", body)["recipes"]:
            print(f"{recipe['recipe_id']:>6}  {recipe['recipe_name']}  (coverage {recipe['coverage']:.0%})")
            print(f"        matched: {recipe['matched']}\n        missing: {recipe['missing']}")


if __name__ == "__main__":
    main()
