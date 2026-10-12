from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from recipe_service import (
    recommend_recipes,
    find_missing_ingredients,
)


app = FastAPI(
    title="Recipe Recommendation Service",
    version="1.0.0",
)


class RecommendRequest(BaseModel):
    available_ingredients: list[str]

    top_k: int = Field(
        default=5,
        ge=1,
        le=10,
    )

    min_coverage: float = Field(
        default=0.3,
        ge=0,
        le=1,
    )

    max_missing_ingredients: int = Field(
        default=4,
        ge=0,
        le=20,
    )


class MissingRequest(BaseModel):
    recipe_id: int
    available_ingredients: list[str]


@app.get("/health")
def health():
    return {
        "status": "ok"
    }


@app.post("/recommend")
def recommend(
    request: RecommendRequest
):
    recipes = recommend_recipes(
        available_ingredients=request.available_ingredients,
        top_k=request.top_k,
        min_coverage=request.min_coverage,
        max_missing_ingredients=request.max_missing_ingredients,
    )

    return {
        "recipes": recipes
    }


@app.post("/missing")
def missing(
    request: MissingRequest
):
    result = find_missing_ingredients(
        recipe_id=request.recipe_id,
        available=request.available_ingredients,
    )

    if result["recipe_name"] is None:
        raise HTTPException(
            status_code=404,
            detail="Recipe not found",
        )

    return result