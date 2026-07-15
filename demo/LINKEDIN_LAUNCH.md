# BibTeX Verifier — LinkedIn launch kit

## Recommended format

Post a **native MP4**, not a GIF. LinkedIn video preserves more detail, supports captions, shows a proper play experience, and is much smaller than a 46-second high-resolution GIF. Keep the GIF for the GitHub README.

Ready-to-upload assets:

- `demo/bibtex-verifier-linkedin.mp4` — 1080 × 1350, H.264, 30 fps, 46.2 seconds
- `demo/bibtex-verifier-linkedin-cover.jpg` — opening hook cover image

Run `npm run render:showcase` whenever the slideshow changes to regenerate the MP4 automatically with headless Chrome and FFmpeg.

Suggested export:

- 1080 × 1350, 4:5 (recommended for the LinkedIn mobile feed)
- 30 fps
- H.264 MP4
- 8–12 Mbps video bitrate
- No browser chrome or mouse movement
- Optional quiet background music; the showcase is designed to work without audio

## Recording the showcase

1. Open `docs/showcase.html` in a browser. It defaults to the mobile-first 4:5 format.
2. Press **F** for fullscreen.
3. Press **R** to restart at scene one.
4. Move the pointer off-screen; controls hide after 2.2 seconds.
5. Record the full 46-second loop with OBS, Screen Studio, or your desktop recorder.

Useful URL options:

- `?controls=0&loop=0` — clean one-shot recording; stops on the CTA
- `?autoplay=0` — presenter mode with manual arrow-key navigation
- `?slide=4&autoplay=0` — open directly on a scene (zero-based)
- `?format=landscape` — use the original 1920 × 1080 edition

For the strongest LinkedIn result, trim any dead time so the first words appear in the first frame.

## Suggested LinkedIn post

**ChatGPT can write a bibliography in seconds.**

The uncomfortable question: **do those papers actually exist?**

I built **BibTeX Verifier**, a free and open-source tool that checks your `.bib` file against Semantic Scholar and Crossref, with OpenAlex fallback, before a bad citation reaches your paper.

It can:

→ flag likely AI-hallucinated references  
→ catch wrong authors, years, venues, and DOIs  
→ show every correction field by field  
→ generate a clean BibTeX file for Overleaf or LaTeX

Everything runs in the browser. Your bibliography is parsed locally, with only paper titles used for public academic API lookups. No account, no server, no tracking.

Try it: https://merfanian.github.io/Bibtex-Verifier/  
Source: https://github.com/merfanian/Bibtex-Verifier

If this could save a researcher from submitting a fabricated citation, please **star the repo or share it with someone writing a paper**.

What is the strangest citation error an AI tool has given you?

#OpenSource #ResearchTools #AcademicWriting #BibTeX #LaTeX

## Launch checklist

- Put the live demo link in the first three lines or first comment.
- Upload the MP4 natively; do not post a YouTube link as the main media.
- Use a cover frame with the hook: “But do the papers actually exist?”
- Tag 3–5 relevant people only when they genuinely know the project.
- Reply to every substantive comment during the first hour.
- Post a short technical follow-up 2–3 days later about fuzzy matching, browser privacy, or API rate limiting.
- Ask for one action: **star or share**, not several competing actions.
- Avoid claiming every “Not found” result is fabricated; some real work is not indexed.

## Optional variants

### Short post

Two months ago, I started **BibTeX Verifier** as a simple tool for checking references in research papers.

Today, it has passed **50 stars on GitHub** and is gaining attention from the research and open-source communities! ⭐

Thank you to everyone who tried it, shared feedback, or starred the repository.

**Try it, use it on your next bibliography, and—if it helps—give it a star!**

Live app: https://merfanian.github.io/Bibtex-Verifier/  
GitHub: https://github.com/merfanian/Bibtex-Verifier

### Carousel alternative

Export still frames from scenes 1, 4, 5, 6, and 8 as a five-page PDF carousel:

1. The hook
2. Color-coded bibliography results
3. Hallucination detection
4. Field-by-field correction
5. Privacy promise + GitHub CTA

A carousel can outperform video when the audience prefers to stop and inspect technical UI. Publish the video first, then use the carousel as a follow-up rather than posting both at once.
