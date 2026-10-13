# Recipe Chatbot

Tell it what you have, or send a fridge photo. It suggests recipes from a recipe database,
builds a shopping list of what is missing, and compares prices at the Willys and Hemköp
stores nearest you.

## Run

### Mac / Linux

```bash
export LLM_PROVIDER=gemini          # or openrouter
export GEMINI_API_KEY=your-key      # or OPENROUTER_API_KEY=your-key
export TAVILY_API_KEY=your-key      # optional: web search and dish photos
docker compose up --build
```

### Windows (PowerShell)

```powershell
$env:LLM_PROVIDER="gemini"          # or openrouter
$env:GEMINI_API_KEY="your-key"      # or $env:OPENROUTER_API_KEY="your-key"
$env:TAVILY_API_KEY="your-key"      # optional: web search and dish photos
docker compose up --build
```

Open http://localhost:4300

## How it works

Each recipe reply has three tabs:

1. **Recipes** – the model reads your ingredients (text or photo) and the recipe service
   finds matching recipes. Pick one or more.
2. **Shopping list** – the recipe service lists what is missing. The model adds amounts and a
   Swedish search word. Items you can cover with what you have start unticked.
3. **Prices** – the cheapest plan at Willys and Hemköp. The browser asks for your location
   to use the nearest stores; without it, the stores' default online prices are used.

## Services

| Service | Port | What it does |
|---|---|---|
| `frontend` | 4300 | Angular chat app |
| `backend` | 3100 | Next.js API: chat, tools, shopping lists, price comparison |
| `recipe-service` | 8000 | FastAPI: `/recommend` and `/missing` over the recipe dataset |
| `database` | 5434 | PostgreSQL |

## Options

| Variable | Default | Meaning |
|---|---|---|
| `RECIPE_MATCHER` | `ontology` | `ontology` matches ingredients with the Open Food Facts taxonomy (fresh tomato covers whole peeled tomato). `exact` is the original name matching. |
| `OPENROUTER_MODEL` | see `compose.yaml` | Model used with OpenRouter |

Compare the two matchers:

```bash
docker compose run -d --name recipe-exact -p 8001:8000 -e RECIPE_MATCHER=exact recipe-service
python3 recipe-service/scripts/compare_matchers.py "tomato, garlic, onion, olive oil"
docker rm -f recipe-exact
```

## Tests

```bash
(cd backend && npm test)                                     # backend
(cd recipe-service/app && python3 -m unittest test_ontology)  # ingredient matching
```

## Notes

- Prices come from the public product search on willys.se and hemkop.se. It is not an
  official API and can change. Only stores with an online shop have prices.
- Willys has the same prices in every store; Hemköp prices differ between stores.
- Your location is only used to pick the nearest stores and is not saved.
- Ingredient taxonomy: Open Food Facts, under the Open Database License
  (see `recipe-service/data/ontology/README.md`).
