# Recipe Chatbot

## Mac / Linux

```bash
export LLM_PROVIDER=gemini          # or openrouter
export GEMINI_API_KEY=your-key      # or OPENROUTER_API_KEY=your-key
export TAVILY_API_KEY=your-key      # optional: web search
docker compose up --build
```

## Windows (PowerShell)

```powershell
$env:LLM_PROVIDER="gemini"          # or openrouter
$env:GEMINI_API_KEY="your-key"      # or $env:OPENROUTER_API_KEY="your-key"
$env:TAVILY_API_KEY="your-key"      # optional: web search
docker compose up --build
```

Open http://localhost:4300
