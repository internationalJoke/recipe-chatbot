from pathlib import Path
import pandas as pd
from ingredient_matcher import canonicalize

# =========================================================
# Paths
# =========================================================

PROJECT_ROOT = Path(__file__).resolve().parent.parent
PROCESSED_DIR = PROJECT_ROOT / "data" / "processed"

RECIPES_FILE = PROCESSED_DIR / "recipes.csv"
INGREDIENTS_FILE = PROCESSED_DIR / "recipe_ingredients.csv"


# =========================================================
# Load data
# =========================================================

recipes_df = pd.read_csv(
    RECIPES_FILE,
    low_memory=False
)

ingredients_df = pd.read_csv(
    INGREDIENTS_FILE,
    low_memory=False
)


# =========================================================
# Basic normalization
# =========================================================

def normalize_ingredient_name(name):
    """
    Very simple normalization for baseline matching.

    Example:
        " Egg " -> "egg"
        "Tomatoes" -> "tomatoes"

    For now we only normalize case and whitespace.
    More advanced matching can be added later.
    """

    if pd.isna(name):
        return None

    return str(name).strip().lower()


# =========================================================
# Recipe lookup
# =========================================================

def get_recipe_ingredients(recipe_id):
    """
    Return all valid ingredient names for a recipe.

    Parameters
    ----------
    recipe_id : int
        ID of the recipe.

    Returns
    -------
    list[str]
        Ingredient names required by the recipe.
    """

    rows = ingredients_df[
        (ingredients_df["recipe_id"] == recipe_id)
        & (ingredients_df["status"] == "ok")
        & (ingredients_df["name"].notna())
    ]

    ingredients = (
        rows["name"]
        .apply(normalize_ingredient_name)
        .dropna()
        .drop_duplicates()
        .tolist()
    )

    return ingredients


# =========================================================
# Ingredient comparison
# =========================================================

def compare_ingredients(required, available):
    """
    Compare required recipe ingredients with available ingredients.

    Parameters
    ----------
    required : list[str]
        Ingredients required by the recipe.

    available : list[str]
        Ingredients detected from the user's image
        or entered manually.

    Returns
    -------
    dict
        Matching result.
    """

    required_set = {
        canonicalize(x)
        for x in required
        if x is not None
    }

    available_set = {
        canonicalize(x)
        for x in available
        if x is not None
    }

    matched = required_set & available_set
    missing = required_set - available_set

    if len(required_set) == 0:
        coverage = 0.0
    else:
        coverage = len(matched) / len(required_set)

    return {
        "required": sorted(required_set),
        "available": sorted(available_set),
        "matched": sorted(matched),
        "missing": sorted(missing),
        "coverage": coverage
    }


# =========================================================
# High-level function
# =========================================================

def find_missing_ingredients(
    recipe_id,
    available
):
    required = set(
        get_recipe_ingredients(recipe_id)
    )

    available_set = {
        canonicalize(x)
        for x in available
        if x
    }

    available_set = {
        x
        for x in available_set
        if x
    }

    matched = required & available_set
    missing = required - available_set

    coverage = (
        len(matched) / len(required)
        if required
        else 0.0
    )

    return {
        "recipe_id": recipe_id,
        "recipe_name": get_recipe_name(recipe_id),
        "required": sorted(required),
        "available": sorted(available_set),
        "matched": sorted(matched),
        "missing": sorted(missing),
        "matched_count": len(matched),
        "missing_count": len(missing),
        "coverage": coverage
    }



def get_recipe_name(recipe_id):
    rows = recipes_df[
        recipes_df["recipe_id"] == recipe_id
    ]

    if rows.empty:
        return None

    return rows.iloc[0]["title"]

# =========================================================
# Precompute lookup tables
# =========================================================

# 1. recipe_id -> recipe name
recipe_name_map = dict(
    zip(
        recipes_df["recipe_id"],
        recipes_df["title"]
    )
)


# 2. Keep only valid ingredient rows
valid_ingredients_df = ingredients_df[
    (ingredients_df["status"] == "ok")
    & (ingredients_df["name"].notna())
].copy()


# Apply canonicalization only once
valid_ingredients_df["canonical_name"] = (
    valid_ingredients_df["name"]
    .apply(canonicalize)
)


# 3. recipe_id -> list of canonical ingredient names
recipe_ingredient_map = (
    valid_ingredients_df
    .groupby("recipe_id")["canonical_name"]
    .apply(
        lambda x: sorted(
            set(x.dropna())
        )
    )
    .to_dict()
)


# =========================================================
# Fast recipe lookup
# =========================================================

def get_recipe_name(recipe_id):
    return recipe_name_map.get(recipe_id)


def get_recipe_ingredients(recipe_id):
    return recipe_ingredient_map.get(
        recipe_id,
        []
    )


# =========================================================
# Recipe recommendation
# =========================================================

def recommend_recipes(
    available_ingredients,
    top_k=5,
    min_coverage=0.3,
    min_required_ingredients=4,
    min_matched_ingredients=2,
    max_missing_ingredients=4
):
    """
    Recommend recipes based on the user's available ingredients.
    """

    available_set = {
        canonicalize(x)
        for x in available_ingredients
        if x is not None
    }

    available_set = {
        x for x in available_set if x
    }

    if not available_set:
        return []

    results = []

    for recipe_id, required in recipe_ingredient_map.items():

        required_set = set(required)

        if not required_set:
            continue

        if len(required_set) < min_required_ingredients:
            continue

        matched = required_set & available_set
        missing = required_set - available_set

        matched_count = len(matched)
        missing_count = len(missing)

        if matched_count < min_matched_ingredients:
            continue

        if missing_count > max_missing_ingredients:
            continue

        coverage = matched_count / len(required_set)

        if coverage < min_coverage:
            continue

        ingredient_usage = matched_count / len(available_set)
        ingredient_usage = min(ingredient_usage, 1.0)

        recommendation_score = (
            coverage * 0.6
            + ingredient_usage * 0.4
        )

        results.append({
            "recipe_id": recipe_id,
            "recipe_name": get_recipe_name(recipe_id),
            "coverage": coverage,
            "recommendation_score": recommendation_score,
            "matched_count": matched_count,
            "missing_count": missing_count,
            "matched": sorted(matched),
            "missing": sorted(missing),
            "required": sorted(required_set)
        })

    results.sort(
        key=lambda x: (
            -x["recommendation_score"],
            x["missing_count"],
            -x["matched_count"]
        )
    )

    return results[:top_k]
# =========================================================
# Test
# =========================================================
if __name__ == "__main__":

    # =====================================================
    # Test 1: Missing ingredient detection for one recipe
    # =====================================================

    test_recipe_id = 0

    detected_ingredients_for_recipe = [
        "whole chicken",
        "kosher salt",
        "acorn squash",
        "sage",
        "rosemary",
        "olive oil"
    ]

    result = find_missing_ingredients(
        recipe_id=test_recipe_id,
        available=detected_ingredients_for_recipe
    )

    recipe_name = get_recipe_name(test_recipe_id)

    print("\n" + "=" * 50)
    print("TEST 1: MISSING INGREDIENT DETECTION")
    print("=" * 50)

    print(f"\nRecipe ID: {result['recipe_id']}")
    print(f"Recipe name: {recipe_name}")

    print("\nRequired ingredients:")
    for ingredient in result["required"]:
        print("-", ingredient)

    print("\nAvailable ingredients:")
    for ingredient in result["available"]:
        print("-", ingredient)

    print("\nMatched ingredients:")
    for ingredient in result["matched"]:
        print("-", ingredient)

    print("\nMissing ingredients:")
    for ingredient in result["missing"]:
        print("-", ingredient)

    print(
        f"\nCoverage: "
        f"{result['coverage']:.1%}"
    )

    # =====================================================
    # Test 2: Recipe recommendation
    # =====================================================

    detected_ingredients_for_recommendation = [
        "egg",
        "tomato",
        "onion",
        "olive oil",
        "garlic"
    ]

    print("\n" + "=" * 50)
    print("TEST 2: RECIPE RECOMMENDATION")
    print("=" * 50)

    print("\nDetected ingredients:")
    for ingredient in detected_ingredients_for_recommendation:
        print("-", ingredient)

    print("\nCalculating recommendations...")


    recommendations = recommend_recipes(
        detected_ingredients_for_recommendation,
        top_k=5,
        min_coverage=0.3,
        min_required_ingredients=4,
        min_matched_ingredients=2
    )

    print("Done.")

    print("\nTop recommended recipes:")

    for i, recipe in enumerate(
            recommendations,
            start=1
    ):
        print("\n" + "-" * 50)

        print(
            f"{i}. "
            f"{recipe['recipe_name']}"
        )

        print(
            f"Recipe ID: "
            f"{recipe['recipe_id']}"
        )

        print(
            f"Coverage: "
            f"{recipe['coverage']:.1%}"
        )

        print(
            f"Recommendation score: "
            f"{recipe['recommendation_score']:.3f}"
        )

        print(
            f"Matched: "
            f"{recipe['matched_count']}"
        )

        print(
            f"Missing: "
            f"{recipe['missing_count']}"
        )

        print(
            "Matched ingredients:",
            recipe["matched"]
        )

        print(
            "Missing ingredients:",
            recipe["missing"]
        )