"""
Ingredient matching with the Open Food Facts ingredient taxonomy.

Each ingredient name is linked to a taxonomy node ("whole peeled tomatoes"
-> "peeled tomato", whose parent is "tomato"). A recipe ingredient counts as
available when the user has:
  - the same node, or
  - the plain food it is prepared from (tomato counts for peeled tomato).
A more specific kind does not count for the general one: the taxonomy puts
spring onion under onion, but scallions do not replace an onion.

Names the taxonomy does not know keep their own cleaned-up name, so they
still match exactly, as before.
"""

import re
import unicodedata
from pathlib import Path

DEFAULT_TAXONOMY = Path(__file__).resolve().parent.parent / "data" / "ontology" / "off_ingredients.txt"

LANG_LINE = re.compile(r"^([a-z]{2,3}):\s*(.+)$")
PARENT_LINE = re.compile(r"^<\s*en:\s*(.+)$")

# Describe the form, not the food: "thyme leaves" is thyme, "lime wedges" is lime.
FORM_WORDS = {"leaf", "leave", "wedge", "sprig", "cube", "slice", "piece", "stalk", "zest", "peel"}

# Preparation only: a peeled or chopped tomato is still made from a tomato you have.
PREP_WORDS = {
    "peeled", "whole", "fresh", "chopped", "diced", "sliced", "minced", "grated",
    "shredded", "crushed", "halved", "quartered", "trimmed", "cut", "raw", "ripe",
}

# Change the product: dried cherries are not cherries, canned tomatoes are not fresh.
KEEP_WORDS = {"dried", "dry", "canned", "smoked", "pickled", "frozen", "roasted", "toasted", "candied", "sweetened"}

# Too general to stand for the whole name: "almond extract" is not "extract".
GENERIC_TAILS = {
    "extract", "flake", "paste", "powder", "sauce", "fat", "juice", "seasoning",
    "seasoning blend", "blend", "mix", "spice", "water", "oil", "stock", "broth",
}

# Rows in the recipe data that are not ingredients.
JUNK = {"accompaniment", "equipment", "ingredient info", "special equipment", "garnish"}

MAX_WORDS = 7


def _strip_accents(text):
    return "".join(c for c in unicodedata.normalize("NFKD", text) if not unicodedata.combining(c))


def _singular(word):
    if word.endswith("ies"):
        return word[:-3] + "y"
    if word.endswith("oes"):
        return word[:-2]
    if word.endswith("s") and not word.endswith("ss"):
        return word[:-1]
    return word


def clean(name):
    """Lowercase, no accents or punctuation, last word singular: 'Jalapeños' -> 'jalapeno'."""
    if not name:
        return ""
    text = _strip_accents(str(name).lower()).replace("-", " ")
    text = re.sub(r"[^a-z ]", " ", text)
    words = text.split()
    if not words:
        return ""
    return " ".join(words[:-1] + [_singular(words[-1])])


class Ontology:
    def __init__(self, path=DEFAULT_TAXONOMY):
        self.index = {}  # cleaned synonym -> node id
        self.names = {}  # node id -> cleaned main name
        self.parents = {}  # node id -> set of parent ids
        self._load(Path(path))
        self.children = {}
        for child, parents in self.parents.items():
            for parent in parents:
                self.children.setdefault(parent, set()).add(child)

    def _load(self, path):
        raw_parents = {}
        block_en, block_parents = None, []

        def flush():
            if block_en:
                node = "en:" + clean(block_en[0]).replace(" ", "-")
                self.names.setdefault(node, clean(block_en[0]))
                for synonym in block_en:
                    self.index.setdefault(clean(synonym), node)
                raw_parents.setdefault(node, []).extend(block_parents)

        for line in path.open(encoding="utf-8"):
            line = line.strip()
            if not line:
                flush()
                block_en, block_parents = None, []
                continue
            parent = PARENT_LINE.match(line)
            if parent:
                block_parents.append(parent.group(1))
                continue
            lang = LANG_LINE.match(line)
            if lang and lang.group(1) == "en" and block_en is None:
                block_en = [part.strip() for part in lang.group(2).split(",") if part.strip()]
        flush()

        for node, parent_names in raw_parents.items():
            ids = {self.index.get(clean(name)) for name in parent_names}
            self.parents[node] = {i for i in ids if i and i != node}

    def node_for(self, name):
        """The taxonomy node for an ingredient name, or 'raw:<cleaned name>' when there is none."""
        cleaned = clean(re.split(r"\bwith\b", str(name or ""), maxsplit=1)[0])
        if not cleaned or cleaned in JUNK:
            return None
        if len(cleaned.split()) > MAX_WORDS:
            return "raw:" + cleaned
        words = cleaned.split()
        for attempt in (words, [w for w in words if w not in FORM_WORDS]):
            for start in range(len(attempt)):
                tail = " ".join(attempt[start:])
                node = self.index.get(tail)
                if not node:
                    continue
                dropped = set(attempt[:start])
                if start and (tail in GENERIC_TAILS or dropped & KEEP_WORDS):
                    break
                return node
        return "raw:" + cleaned

    def prepared_from(self, node):
        """Children that are only a preparation of this food: tomato -> peeled tomato, chopped tomato."""
        base = set(self.names.get(node, "").split())
        result = set()
        for child in self.children.get(node, ()):
            extra = set(self.names.get(child, "").split()) - base
            if extra and extra <= PREP_WORDS:
                result.add(child)
        return result

    def covered(self, available_names):
        """Every node the user's ingredients cover."""
        covered = set()
        for name in available_names:
            node = self.node_for(name)
            if not node:
                continue
            covered.add(node)
            if not node.startswith("raw:"):
                covered |= self.prepared_from(node)
        return covered
