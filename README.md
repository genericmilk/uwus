# UWU News

Fetches today's top news from RSS feeds, rewrites the stories using Claude AI, generates text-to-speech audio via ElevenLabs, then mixes everything with a music bed to produce a radio-style news bulletin.

Two modes:
- **UWU mode** — kawaii news anchor (Gigi voice), replaces r/l with w, OwO/UwU/nyaa~
- **Northern mode** — John of the North, thick northern dialect, tree-felling tangents, surgery metaphors, DO YOU KNOW

---

## Requirements

- [Bun](https://bun.sh) runtime
- [ffmpeg](https://ffmpeg.org) (must be on PATH)
- An [OpenRouter](https://openrouter.ai) API key
- An [ElevenLabs](https://elevenlabs.io) API key

Install Bun:
```bash
curl -fsSL https://bun.sh/install | bash
```

Install ffmpeg (macOS):
```bash
brew install ffmpeg
```

---

## Setup

1. Clone/download the project and `cd` into it

2. Install dependencies:
```bash
bun install
```

3. Copy the env template and fill in your API keys:
```bash
cp .env.example .env
```

`.env` should contain:
```
OPENROUTER_API_KEY=your_openrouter_key_here
ELEVENLABS_API_KEY=your_elevenlabs_key_here
```

4. Ensure the required audio files are present in the `branding/` directory:

| File | Purpose |
|------|---------|
| `branding/bed.mp3` | Music bed — loops under the newsreader |
| `branding/intro.mp3` | Opening jingle — plays at start and end |
| `branding/bridge.mp3` | Transition stinger — plays between headlines and stories |

---

## Usage

**UWU mode** (default):
```bash
bun run index.ts
```

**Northern mode** — John of the North:
```bash
bun run index.ts --northern
```

Output is written to `final.mp3` in the project directory. A `tmp/` folder is created during processing and automatically deleted on completion.

---

## Output structure

```
[intro.mp3]
[welcome + headlines] — newsreader over looping bed.mp3 (ducked)
[bridge.mp3]
[individual stories] — newsreader only, no bed
[goodbye sign-off] — newsreader over looping bed.mp3 (ducked)
[intro.mp3]
```

The music bed uses sidechain compression — it automatically ducks down when the newsreader speaks and rises back up during pauses.

---

## RSS sources

- BBC News
- NPR
- New York Times
- The Guardian

Claude selects 5–8 stories per run and rewrites them in the chosen style.

---

## Runtime

Approximately 60–90 seconds depending on network speed and ElevenLabs queue.
