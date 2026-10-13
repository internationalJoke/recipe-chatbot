import re


def normalize_basic(name):
    if name is None:
        return None

    name = name.lower().strip()

    name = name.replace("-", " ")

    name = re.sub(r"\s+", " ", name)

    return name


def singularize_simple(name):
    """
    Very lightweight plural handling.
    Avoids aggressive linguistic rules.
    """

    if name.endswith("ies"):
        return name[:-3] + "y"

    if name.endswith("oes"):
        return name[:-2]

    if name.endswith("s") and not name.endswith("ss"):
        return name[:-1]

    return name


def canonicalize(name):
    """
    Convert ingredient names into a simplified form
    for baseline matching.
    """

    name = normalize_basic(name)

    if not name:
        return name

    name = singularize_simple(name)

    aliases = {
        "extra virgin olive oil": "olive oil",
        "extra virgin olive oils": "olive oil",

        "red onion": "onion",
        "yellow onion": "onion",
        "white onion": "onion",

        "unsalted chicken broth": "chicken broth",
        "low sodium chicken broth": "chicken broth",

        "black pepper": "pepper",
        "ground black pepper": "pepper",

        "kosher salt": "salt",
        "sea salt": "salt",
    }

    return aliases.get(name, name)