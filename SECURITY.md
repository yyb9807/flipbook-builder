# Security

The editor has no user accounts, role permissions or tenant isolation. The default Compose ports bind to localhost. Keep editing in a personal or trusted network. Public readers use the separate `reader` service or exported static files. The live `/v/{projectId}` route belongs to the editor and is not a security boundary.

The independent reader mounts only `data/publications/` read-only, runs without database or model configuration, and exposes only allowlisted GET/HEAD resources and health. Server-authored snapshots freeze the project, copied PNG images and trusted reader code. No client HTML or JavaScript is accepted. Private manifests, histories, jobs and provider settings are excluded from public resources. Preserve and back up this directory even when deleting source projects.

Anyone who obtains a publication URL can read and redistribute it. It is not authenticated sharing. Withdrawal rejects future requests with no-store responses, but cannot recall downloaded or already rendered content. Publication management remains on the trusted editor API, including the global library for publications whose source was deleted. Expose only the reader port publicly, using HTTPS and a matching `PUBLICATION_BASE_URL`.

API keys are temporary in browser memory by default. Remembering a key explicitly writes it to browser storage as plain text. Generation and test requests send it to the self-hosted backend and selected provider. Do not publish real keys in source code, issues, screenshots, logs or workflow inputs.

Uploaded images are decoded and re-encoded before serving. Export data is escaped and publications use allowlisted fields. These controls do not replace keeping dependencies updated.

To report a vulnerability privately, contact the maintainer at yyb980716@gmail.com. Include a minimal reproduction using synthetic data and fake credentials. Please avoid publicly posting working credential-exfiltration payloads before maintainers can assess a report.

The baseline audit and subsequent implementation record are in `docs/`. A historical audit finding is not a statement that the current revision remains vulnerable.
