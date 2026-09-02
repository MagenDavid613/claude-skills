# claude-skills

Personal Claude Code / Claude Desktop skills.

## Install a skill on a new machine

```bash
git clone https://github.com/MagenDavid613/claude-skills.git
cp -R claude-skills/skills/scroll-craft ~/.claude/skills/scroll-craft
cd ~/.claude/skills/scroll-craft
cp .env.example .env   # then fill in MAGNIFIC_API_KEY (and/or KIE_AI_API_KEY)
node scripts/doctor.mjs --probe
```

## Skills in this repo

- **scroll-craft** — builds premium, scroll-driven interactive landing pages.
  Forked from [nateherkai/scroll-craft](https://github.com/nateherkai/scroll-craft)
  with an added Magnific asset generator (`scripts/magnific.mjs`, using
  `nano-banana-pro-flash` for stills and `kling-v2-1-master` for camera-move
  clips) alongside the original kie.ai one. If `MAGNIFIC_API_KEY` is set the
  skill uses Magnific; otherwise it falls back to `KIE_AI_API_KEY` / kie.ai.
