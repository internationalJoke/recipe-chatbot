"""Run from recipe-service/app: python3 -m unittest test_ontology"""

import unittest

from ontology import Ontology, clean

ONTOLOGY = Ontology()


def covers(available, required):
    return ONTOLOGY.node_for(required) in ONTOLOGY.covered(available)


class CleanTest(unittest.TestCase):
    def test_accents_plural_and_punctuation(self):
        self.assertEqual(clean("Jalapeños"), "jalapeno")
        self.assertEqual(clean("all-purpose flour"), "all purpose flour")


class NodeTest(unittest.TestCase):
    def test_synonyms_and_plurals_share_a_node(self):
        self.assertEqual(ONTOLOGY.node_for("scallions"), ONTOLOGY.node_for("green onion"))
        self.assertEqual(ONTOLOGY.node_for("tomatoes"), ONTOLOGY.node_for("tomato"))

    def test_form_words_are_dropped(self):
        self.assertEqual(ONTOLOGY.node_for("lime wedges"), ONTOLOGY.node_for("lime"))

    def test_generic_tails_and_product_words_do_not_match_loosely(self):
        self.assertTrue(ONTOLOGY.node_for("almond extract").startswith("raw:"))
        self.assertNotEqual(ONTOLOGY.node_for("canned tomatoes"), ONTOLOGY.node_for("tomato"))
        self.assertNotEqual(ONTOLOGY.node_for("dried tart cherries"), ONTOLOGY.node_for("cherry"))

    def test_with_clause_and_junk(self):
        self.assertNotEqual(ONTOLOGY.node_for("beef brisket with fat"), ONTOLOGY.node_for("fat"))
        self.assertIsNone(ONTOLOGY.node_for("equipment"))

    def test_unknown_names_keep_their_own_name(self):
        self.assertEqual(ONTOLOGY.node_for("Grandma's secret mix of things"), "raw:grandma s secret mix of thing")


class CoverTest(unittest.TestCase):
    def test_fresh_tomato_covers_whole_peeled_tomato(self):
        self.assertTrue(covers(["tomato"], "whole peeled tomatoes"))

    def test_specific_kind_does_not_replace_the_general_one(self):
        self.assertFalse(covers(["scallions"], "onion"))

    def test_different_products_stay_missing(self):
        self.assertFalse(covers(["tomato"], "tomato paste"))
        self.assertFalse(covers(["cheese"], "parmesan"))

    def test_unknown_names_still_match_exactly(self):
        self.assertTrue(covers(["zzz sauce"], "zzz sauce"))


if __name__ == "__main__":
    unittest.main()
