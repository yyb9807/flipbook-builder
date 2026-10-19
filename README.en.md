# Flipbook Builder

A self-hosted visual knowledge workspace with no account required. Connect topics, images and explanations into branching projects, edit their content, then export for readers.

[中文](README.md) · [Documentation](docs/README.md) · [Architecture](docs/ARCHITECTURE.md) · [Verification](docs/VERIFICATION.md)

## Try it without AI or a backend

Use Node.js 24:

```sh
cd frontend
npm ci
npm run dev
```

Open the URL printed by Vite, usually http://localhost:5173. Explore the four-page water-cycle example and edit a local copy. Write knowledge pages, add child pages directly from sections, annotate PNG/JPEG/WebP images, save manual source excerpts and link them to sections, then preview and export.

Local projects and history live in this browser; export a backup before clearing site data. Manual local images are limited to 2 MB. Creation inputs and page-content drafts survive navigation and reloads. “Discard these changes” clears only the current page's unsaved draft, keeping drafts on other pages. Save page drafts before previewing or exporting; uncreated file selections stay only for the current session.

## Self-host the AI workflow

With Docker Compose installed:

```sh
cp .env.example .env
docker compose up -d --build
```

Open http://localhost:8080; the independent reader defaults to http://localhost:8081. Both bind to localhost by default. nginx serves the editor and proxies FastAPI; Postgres stores server projects and `data/` holds images and publications.

For AI generation, open “AI services” in the top navigation and configure a content provider. Topic creation and new child pages generate editable knowledge content; illustrations require an explicit choice and an image provider. Uploaded images retain actual image hotspots. The content model must support the required text/vision input. Invalid knowledge output fails explicitly, without fabricated content or automatic paid retries.

Keys stay in page memory by default. Explicitly remembering a key stores it as plain text in browser storage. AI requests send credentials through this instance’s backend to the selected provider; ordinary editing, project and export requests do not send model keys. Endpoint, model and key form one configuration group, so a client endpoint never inherits a deployment key. Connection tests use unsaved drafts; text probes may cost money and image probes do not generate an image.

**The editor is one shared workspace with no login, roles or user isolation, intended for a personal or trusted environment.** Users bring their own keys; deployment defaults are also supported. Public readers should use the independent publication service or exported static files. Keep the editor in a trusted network. Run one editor backend worker and one replica.

## Editing, recovery and attribution

- **Two content modes:** knowledge-page sections connect to child pages; image hotspots use actual image coordinates. The editor, online viewer and offline player share one rendering core.
- **Durable jobs:** root analysis, child generation and eligible single-page regeneration use Postgres/DBOS. Reloads, disconnections and settings navigation do not cancel work. Completed stages are reused; lost temporary keys require explicit resumption. Unknown provider outcomes pause for review before a potentially billable retry.
- **Draft protection:** save status remains visible, successful branches are kept, and active jobs lock the project. Pages with hotspots or structured content cannot be regenerated wholesale, preserving authored text and relationships.
- **Page history:** browse saved content, references, hotspots and generated results. Preview the actual merged restoration before confirming it. Current connection targets, child pages and their descendants are kept, including connected sections absent from the old version. A restoration that changes content adds a version, so the previous content remains recoverable; restored pages require a new author review.
- **Sources and citations:** the “Sources” panel searches Chinese or English Wikipedia, previews a specific revision and its license, and adds the saved excerpt to the page or a selected section. Search needs the backend and internet, with no model or key. Manually entered URLs are not fetched; manual references and section links also work in local projects. Sources and text share one page draft and become effective together when saved.
- **Author review:** references are editable copies saved by the author. A search match, excerpt or citation does not establish factual accuracy or support for a statement. Changes to text, excerpts, references or hotspot labels clear the previous declaration; an author may explicitly declare a new review in the same save. Server-owned generation notes remain separate, and model-generated citations are ignored.

![Source search, section citations and the saved-page preview](docs/images/round11-sources-desktop.jpg)

Each page holds up to 12 references and each section cites up to 6. Unlink a reference before removing it. Readers can jump from a section citation to a saved excerpt and back. Restoration retains sources required by newer connected branches; different copies under the same reference ID cause a conflict that must be resolved first. Fixed publications and ZIPs preserve saved excerpts and citation links without retrieving sources again.

Local history keeps the latest 50 versions per page in the same storage entry as the project. A rejected storage write preserves the saved project and history. Server history lives in Postgres without automatic pruning. Finish generation, saving and all page drafts before restoring. A conflict across tabs keeps current changes and requires an explicit reload of the latest saved whole project; this is not a collaboration protocol. History is not a database or image backup, and deleting a project also deletes its history.

## Preview and export

| Format | Contents and requirements |
|---|---|
| Fixed publication | Frozen project, branches, copied images and reader code, served by an independent read-only service. Each publication has a new link; later edits, restores, source deletion and upgrades do not change old content. |
| Offline ZIP | Shared player, images and project data. Extract the whole folder and open `index.html`; no backend, account or key is required. Page history is excluded. |
| JSON | Project content, structure and attribution, without image binaries, provider settings or page history. |
| Instance link | Read-only interface requiring a running instance. It reads current project data, not an immutable publication snapshot. |

Publish server projects through “Export & share → Publish a fixed version”. “Published versions” in the library also manages publications whose sources have been deleted. Finish all drafts, saves and generation first; stale revisions are rejected. Withdrawal stops future reads but cannot recall downloaded copies. Anyone with the link can read it; random addresses are not private access control. Local projects continue to use offline ZIPs.

For other devices, set `PUBLICATION_BASE_URL` to a reachable HTTPS reader address and configure `READER_BIND` / `READER_PORT` for your deployment. Expose only the reader to public visitors. It mounts `data/publications/` read-only and needs no database, model credentials or editor API. Retain and back up this directory independently of source projects.

Keep the ZIP files together. Publish the entire extracted folder as static files. Actual browser acceptance covers HTTP playback; the independent player verifier covers JSDOM file URLs. Cross-browser acceptance of double-clicked `file://` files remains pending.

## Development and verification

The [model quality workflow](docs/MODEL_QUALITY.md) includes Chinese/English development and independent holdout cases, with separate agent and human reviews. It defaults to offline replay and `legacy-v1`; `grounded-v2` and `focused-v3` require explicit selection and remain disabled by default on the server. Controlled replay does not demonstrate real quality improvements; see [round 10](docs/archive/ROUND_10_IMPLEMENTATION.md) for the unreviewed status and implementation limits.

Use Node.js 24, Python 3.13 and Postgres 16. The [frontend guide](frontend/README.md) covers shared rendering, browser state and builds; the [backend guide](backend/README.md) covers local startup, configuration and API contracts. See the [architecture](docs/ARCHITECTURE.md) for modules and data flow.

All check commands, recent local results and limits live in the [verification guide](docs/VERIFICATION.md). The latest functional acceptance uses controlled providers, with zero real model calls. This repository has no GitHub Actions CI/CD configuration.

Back up the database and `data/`; `docker compose down -v` removes database volumes. [Historical reports](docs/archive/README.md) are retained for traceability, not as current setup instructions.

## Contributing and license

Please read [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md). The project uses the [MIT license](LICENSE); referenced third-party projects retain their own licenses.
