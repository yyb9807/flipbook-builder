# Security

The editor has no user accounts, role permissions or tenant isolation. The default Compose ports bind to localhost. Use the editor in a personal or trusted environment; publish static offline works for public readers.

API keys are temporary in browser memory by default. Remembering a key explicitly writes it to browser storage as plain text. Generation and test requests send it to the self-hosted backend and selected provider. Do not publish real keys in source code, issues, screenshots, logs or workflow inputs.

Uploaded images are decoded and re-encoded before serving. Export data is escaped and publications use allowlisted fields. These controls do not replace keeping dependencies updated.

To report a vulnerability privately, contact the maintainer at yyb980716@gmail.com. Include a minimal reproduction using synthetic data and fake credentials. Please avoid publicly posting working credential-exfiltration payloads before maintainers can assess a report.

The baseline audit and subsequent implementation record are in `docs/`. A historical audit finding is not a statement that the current revision remains vulnerable.
