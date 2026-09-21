# I Hate My CV

Upload your CV once, build a Career Library, and generate a tailored CV for every job without
redesigning it from scratch.

## Running it

```bash
npm install
echo "OPENAI_API_KEY=sk-..." > .env.local
npm run dev
```

AI calls go through the OpenAI Responses API with structured outputs (`src/lib/ai.ts`).

| Job | Default model | Override | Reasoning |
| --- | --- | --- | --- |
| Reading an uploaded CV | `gpt-5.4` | `OPENAI_MODEL` | high |
| Tailoring to a job | `gpt-5.4` | `OPENAI_MODEL` | high |
| Add from notes | `gpt-5.4-mini` | `OPENAI_FAST_MODEL` | medium |

The defaults fall within OpenAI's free daily token allowance for organisations that share
traffic with OpenAI. `OPENAI_MODEL` must be able to read images.

Open http://localhost:3000. Without an API key the UI still works; to try it with demo data, run
`curl -X POST http://localhost:3000/api/dev/seed` (development only).

Data lives in `data/` (git-ignored): `store.json` plus `source-pages/`, which holds renders of the
uploaded PDF.

## How it works

A CV is **design × content**. The design is captured once from the original and never changes;
tailoring only ever produces new content, so every generated CV looks like the original.

| Step | Where | What happens |
| --- | --- | --- |
| Upload | `/upload`, `api/extract` | The browser parses the PDF with pdf.js (text positions, font names, page renders). The model measures the design into a `DesignSpec` and extracts every component into the Career Library, copying bullets verbatim. |
| Design check | `/design` | The rebuild is overlaid on the original page renders. A mis-measured size or margin is fixed here once and applies to every CV. |
| Career Library | `/library` | Edit, archive, reorder and add entries. **Add from notes** turns rough notes into entries written in the voice of the existing bullets, using only facts from the notes. |
| Tailor | `/tailor`, `api/tailor` | The model selects, drops and reorders library components by id for a job description. It cannot write or reword text. |
| Edit and export | `/cv/[id]` | Manual pick/drop/reorder/correct, a match report, and export to PDF through the browser's print dialog. |

### Keeping the page count

The library grows but the page doesn't. At extraction, each section records its **baseline**:
how many entries, the most bullets on any entry, and how many skills the original showed
(`SectionDef.baseline`). Tailoring is told these numbers, and `applyTailorPlan` enforces them as
hard caps: original entries + 1, the original maximum for bullets per entry, and original skills
+ 2. Anything over a cap is cut from the end of the model's ranking. The preview warns when a CV
still runs longer than the original.

## Code map

- `src/types/cv.ts`: the domain model (`DesignSpec`, `CareerLibrary`, `CvDocumentData`)
- `src/lib/assemble.ts`: normalising model output, baselines, applying tailoring plans
- `src/lib/prompts.ts`, `src/lib/schemas.ts`: prompts and structured-output schemas
- `src/components/cv/CvDocument.tsx`: the renderer; pure `design × data`, in pt/mm
- `src/components/design/DesignEditor.tsx`: correcting the captured design
