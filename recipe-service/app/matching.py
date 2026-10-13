"""
How a recipe ingredient is matched against what the user has.

RECIPE_MATCHER=exact     cleaned names must be equal (the original behaviour)
RECIPE_MATCHER=ontology  also links names to the Open Food Facts taxonomy, so
                         "tomato" covers "whole peeled tomatoes". Anything the
                         exact matcher matches still matches.

A recipe ingredient has a set of keys; it is available when any key is covered.
"""

import os
from functools import lru_cache

from ingredient_matcher import canonicalize


class ExactMatcher:
    name = "exact"

    def required_keys(self, raw_name, canonical_name):
        return frozenset({"exact:" + canonical_name})

    def covered(self, available):
        return {"exact:" + c for c in (canonicalize(x) for x in available if x) if c}


class OntologyMatcher(ExactMatcher):
    name = "ontology"

    def __init__(self):
        from ontology import Ontology

        self.ontology = Ontology()
        self._node = lru_cache(maxsize=None)(self.ontology.node_for)

    def required_keys(self, raw_name, canonical_name):
        # The raw name keeps words the old aliases drop ("black pepper" stays black pepper).
        node = self._node(raw_name)
        if node is None:
            return None  # not an ingredient, e.g. "equipment"
        return super().required_keys(raw_name, canonical_name) | {node}

    def covered(self, available):
        names = [x for x in available if x]
        return super().covered(names) | self.ontology.covered(names)


def make_matcher(kind=None):
    kind = (kind or os.environ.get("RECIPE_MATCHER") or "exact").strip().lower()
    if kind == "ontology":
        return OntologyMatcher()
    if kind == "exact":
        return ExactMatcher()
    raise ValueError(f"Unknown RECIPE_MATCHER {kind!r}; use 'exact' or 'ontology'.")
