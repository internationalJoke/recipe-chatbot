# Ingredient ontology

`off_ingredients.txt` is the ingredient taxonomy from Open Food Facts
(https://github.com/openfoodfacts/openfoodfacts-server/blob/main/taxonomies/food/ingredients.txt),
downloaded on 2026-10-13. Open Food Facts data is available under the Open Database License (ODbL).

`app/ontology.py` reads it to match ingredient names (`RECIPE_MATCHER=ontology`).
