# Security policy

## Reporting a vulnerability

Please do not open a public issue for a security problem.
Use the **Report a vulnerability** button on the repository's **Security** tab (GitHub private vulnerability reporting).
Describe what you found and how to reproduce it. You will get an answer as soon as possible.

## What counts

The toolkit promises that files you open are never uploaded. Anything that breaks this promise is a vulnerability, for example:

- a way for a page or a course to send data to the network despite the `connect-src 'none'` policy;
- a way for course code to read toolkit data (saved results, folder handles) across the sandbox boundary;
- a way for a message from an unexpected origin to be accepted by the toolkit or the sandbox.

See `docs/API.md`, section "Security", for how the boundary is built.
