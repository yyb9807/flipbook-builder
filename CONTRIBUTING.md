# Contributing

Use Node.js 24, Python 3.13 and Postgres 16. Follow the [root README](README.md), [frontend guide](frontend/README.md) and [backend guide](backend/README.md) for setup. [Architecture](docs/ARCHITECTURE.md) describes the current implementation; [verification](docs/VERIFICATION.md) lists runnable checks and their limits.

Before proposing a change, run the relevant checks locally. Frontend changes normally require lint, tests and build; changes to rendering or export also require `npm run verify:player`. Backend changes require Ruff and relevant pytest coverage, with a dedicated Postgres test database for integration tests. Task recovery changes also require `scripts/verify_knowledge_generation.py`; changes to saved versions or restoration require `scripts/verify_version_history.py`. Both use real processes and isolated databases. Never point tests at a database containing real projects. Use controlled providers for these checks; they do not evaluate paid model quality.

For bug reports, include the screen, steps, expected result, actual result and relevant versions. Use synthetic content and remove keys, secret-bearing provider responses and private images. Do not commit `.env`, local databases, uploads, generated distributions or machine-specific screenshots and logs.

Publication changes also require the [publication process checks](docs/VERIFICATION.md#真实进程验收), including the trusted player build and independent reader. Preserve immutable snapshot bytes and test source deletion, withdrawal, asset failures and reader isolation. The verifier creates and cleans its own database and storage and uses a fake provider.

Keep image/knowledge rendering in the shared scene components. Preserve legacy project reads and frozen workflow step paths when changing content formats. New model capabilities must be explicit; an OpenAI-compatible URL does not imply vision, image editing or structured-output support. Keep provider credentials out of workflow arguments, checkpoints, events and publications.

Generated content, references and hotspot placement need human evaluation. References are author-supplied and are not automatically fetched or verified. Record actual measurements and provider versions; do not invent cost or quality claims.

For content prompts, parsing or evaluation changes, run the [fixed quality suite](docs/MODEL_QUALITY.md) and `python -m pytest scripts/quality_eval/tests -q` from the repository root. Keep original inputs, sources and boxes versioned; keep live outputs and reviews in ignored `evals/runs/`. Offline replay verifies the harness, not real model knowledge. Review each factual constraint and all four quality dimensions before making quality claims; do not fill calibration results as human approval.

Update the current guides when behavior or commands change. Keep dated investigation and acceptance records in `docs/archive/`, and distinguish historical results from reruns on current code. Preserve raw evidence rather than rewriting its measured values.

This project uses MIT. Do not copy dependencies or assets with incompatible terms; preserve third-party attribution and licenses where required.
