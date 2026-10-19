# Frontend

React / TypeScript / Vite application. Use Node.js 24 and npm.

```bash
npm ci
npm run dev
npm run lint
npm test
npm run verify:player
npm run build
```

The example and local manual authoring work without the backend. AI and server projects use `/api` and `/uploads`, proxied to localhost:8000 in development. Optional `VITE_API_BASE` overrides the API base for streaming requests; the default dev proxy is recommended.

`components/scene/` contains the shared image/knowledge renderer, hotspot editor and read-only player. `scripts/build-player.mjs` builds that player as an IIFE through a Vite virtual module. The exporter loads it on demand; do not maintain a separate frontend viewer implementation.

`npm run build:publication` writes the trusted `player.js` and `player.css` to `backend/publication_runtime/` (or an output directory argument). Docker builds them from source. The backend copies JS/CSS into every immutable publication and hashes all public files; clients submit only an operation ID and saved revision, never executable files. `useProjectPublications` guards drafts, jobs, mutation queues and restoration; unknown outcomes retain the operation and original revision in sessionStorage for safe retries after refresh. `PublishPanel` manages the current server project; the home publication library also manages versions after source deletion. Local projects use offline ZIP. `/v/{projectId}` remains a live instance preview, separate from the independent reader.

Topic creation and new child pages use structured knowledge content. Illustration choices are explicit and frozen in pending operations; text-only creation does not require an image key. `Hotspot` distinguishes image geometry from section connections with null geometry. Keep that distinction through rendering, saves and publications.

Page-level `content_metadata` contains server-owned provenance, author-supplied references and an author review declaration. Reference edits share page drafts and saving; changes clear the old review state. References do not imply fetching or verification. Preserve their public allowlist in JSON/HTML/ZIP, and never merge provider configuration into it. The player verifier builds under both development and production host environments and runs the actual classic-script output in JSDOM.

Local projects, creation drafts and model settings use separate stores. API keys are memory-only unless explicitly remembered. Do not add provider headers to ordinary project requests or include model settings in publications.

Page-content drafts are scoped to project/page. “Discard these changes” confirms and clears only the current page's draft; drafts on other pages stay intact. A later draft entered while the confirmation is open is also preserved. Native text-input undo remains available.

`usePageHistory` and `PageHistoryPanel` list saved page versions and render a read-only restoration preview through `SceneRenderer`. “Preview previous version” selects the previous saved version; restoration requires confirmation after the actual merge is previewed. History restores content, references and hotspots while keeping current targets, parentage, child pages and descendant subtrees. Connected sections absent from the historical version are retained. Restoration resets author review, and changed content is saved as a new version so the previous content can be recovered. Historical server provenance remains page-level; retained newer sections have no separate attribution record.

`libraryStore` writes each local project and its history together under `flipbook-library`, keeping the latest 50 versions per page. A serialization or quota failure does not replace the saved entry or clear drafts. Snapshots omit image data URLs and reuse the current image. The store rereads saved revisions to detect observed changes from another tab, but localStorage has no cross-process compare-and-swap and cannot serialize simultaneous writers. Do not describe this as multi-user collaboration. Removing a project removes its history; public JSON, ZIP and the player exclude history.

New server editing requests carry `expected_revision` and adopt the returned `project_revision`. Restore requests also carry a stable operation ID; after a successful response, read the canonical whole project because a replayed receipt can predate later edits. Generation, pending/failed writes or any page draft block restoration. A 409 preserves the current draft and preview, without an automatic overwrite retry. “Reload saved pages” explicitly reloads the latest whole project. If optimistic writes failed, a durable local recovery copy must be saved first; pending writes are cleared only after a successful reload. Late history responses are ignored after a workspace switch. Server versions live in Postgres without automatic pruning.

Root-page analysis, child-page generation and single-page regeneration use durable server jobs. `generationJobStore` persists operation IDs, original non-secret submission metadata, and event cursors. `useGenerationJobs` is mounted once in `App` and discovers/subscribes to jobs without sending model credentials. Reloading, entering settings, or opening another project stops only the local subscription; explicit cancellation is a separate API call. Server workspaces stay locked until discovery and any completed-page synchronization finish.

When temporary credentials are lost, the job panel requires an explicit resume action and matching original provider addresses/models. Unknown provider results pause for review: a supported accept action keeps existing content, while retry requires a separate billing confirmation. A submission with a lost response retains its original operation ID and inputs; submission retries first look up completed or active jobs for that operation.

An empty server project uses `CreationJobPage`, so a root task remains accessible after reload even before a node exists. Committed project reads atomically adopt a new root and keep existing navigation and content drafts. Regeneration keeps the original page until a committed replacement is read; pages with hotspots or a structured document are protected from regeneration.

Uploads retain a raw SHA-256 fingerprint and file metadata, never file bytes, in browser storage. Actual `File` objects live only in memory; the pending-upload reference is released once the server accepts the task. If the submission was never accepted before a reload, the panel can check the same operation and request the same file again. Upload identity checks require HTTPS or localhost. A changed file must start a new project rather than silently changing the old operation. The initial project-creation request itself does not call a model; a lost response can leave an empty project in the server library.

See the [root README](../README.md) and [architecture](../docs/ARCHITECTURE.md) and [verification guide](../docs/VERIFICATION.md).
