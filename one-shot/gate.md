# Release gate

Tick every item before reporting done. Write N/A with a reason when an item does not apply. Fix failures or list them under Known limitations in the final report. This gate reduces risk; it does not prove the project is secure or bug-free, and the final report must say so.

## Correctness
- [ ] Every acceptance criterion in SPEC.md is met or listed as a known limitation
- [ ] All tests pass, including those from earlier slices
- [ ] Lint and type checks pass with zero errors
- [ ] Builds from a clean checkout (fresh install, build, run)
- [ ] No unrequested features were added

## Security
- [ ] Review against the OWASP Top 10 categories that apply
- [ ] All external input validated on the server side; output encoded
- [ ] Authentication and authorization checked on every protected route and action
- [ ] No secrets in code, committed config or git history; `.env.example` provided
- [ ] Dependency audit run (`npm audit`, `pip-audit` or equivalent); high and critical issues fixed or listed
- [ ] Rate limiting on login, signup and expensive endpoints
- [ ] Error messages do not leak stack traces, paths or internals
- [ ] Security headers and HTTPS set where hosting allows
- [ ] File uploads (if any) restricted by type and size, stored outside the web root

## AI features (if none, mark this section N/A in one line)
- [ ] Untrusted text (user input, web pages, files) is treated as data, never as instructions
- [ ] Model output is validated before use and never executed or rendered unescaped
- [ ] Tools and permissions given to the model are the minimum needed
- [ ] Prompt injection tested with at least three hostile inputs
- [ ] Per-user limits on model calls and cost

## Quality
- [ ] Empty, loading and error states exist for every data view
- [ ] Accessible: labels on inputs, visible focus, keyboard reachable, contrast at least 4.5:1 for body text
- [ ] Responsive at 360, 768 and 1280 px widths with no sideways scrolling
- [ ] Performance basics: images sized and compressed, no blocking scripts, no N+1 queries
- [ ] No console errors in the browser or server logs on the main flows

## Delivery
- [ ] README with prerequisites, setup, run, test and deploy steps that actually work
- [ ] Environment variable template with every required variable described
- [ ] Deploy configuration or instructions for the chosen host
- [ ] Known limitations listed honestly
