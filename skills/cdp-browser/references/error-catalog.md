# Error catalog and recovery

Grouped by the layer that failed. Always prefer `details.nextActions` when the native tool provides it.

## 1. Tool input and schema errors

| Message or symptom | Cause | Fix |
| --- | --- | --- |
| `args` must be an array | Passed a command string | Use `["open", "https://..."]` |
| Unknown command or executable not found | Included `agent-browser` in `args` | Remove the binary name |
| Two modes present | e.g. `args` plus `job` | Keep exactly one mode field |
| `stdin` is not allowed | Used with `electron`, `job`, `qa`, `semanticAction`, `script`, or a non-stdin command | Move content into `args` or choose the right mode |
| `fill` validation error | Missing `text` | Add non-empty `text` |
| `selector` conflicts with locator | Both `selector` and `locator`/`value`/`role`/`name` | Use one targeting style |
| `select` validation error | Missing `value`/`values`, or no `selector`/locator | Provide selector plus value, or role/label plus values |
| `sessionMode` invalid | Passed `--session-mode` in `args` | Use top-level `sessionMode` |
| `--json` in args | Manual structured-output flag | Remove it |
| `assertText` schema error | Added `selector` or locator fields | `assertText` takes only `text` |
| `outputPath` conflicts with artifact | Reused a screenshot/download path | Choose a separate result path |
| Script requires a persisted session | Running with `--no-session` | Start a normal session |

## 2. Connection errors

| Message or symptom | Cause | Fix |
| --- | --- | --- |
| `no remote CDP endpoint configured` | No endpoint in argv or config | Pass `--cdp`, `connect`, or set `cdp.endpoint` |
| `Failed to connect to CDP ... Connection refused` | Chrome not listening, wrong port, tunnel down | `curl http://host:port/json/version`; restart Chrome with `--remote-debugging-port` and a dedicated `--user-data-dir` |
| `403` or empty `/json/version` | Wrong host/port or firewall | Verify address from the Pi host, not from the browser host |
| WebSocket URL mismatch | Chrome advertises `127.0.0.1` through a forwarder | Use the explicit `ws://host:port/devtools/browser/<id>` form |
| Login state missing | Remote browser profile differs from the expected one | Use the remote profile's own login; verify with `get url` and a snapshot |
| `--headed` has no visible effect | Remote browser; no local launch | Treat visibility as remote; verify with a screenshot |

## 3. Page and ref errors

| Message or symptom | Cause | Fix |
| --- | --- | --- |
| `No active page` | No tab selected, tab closed, or blank daemon | `tab list` → `tab <id>` → `snapshot -i` |
| `stale-ref` | Page navigated, rerendered, or ref invalidated | Fresh `snapshot -i`; use new `@eN` |
| Ref not in snapshot | Typo or older snapshot | Re-read the latest snapshot; do not guess numbers |
| `selector-not-found` | Element absent, hidden, in another frame, or wrong selector language | `snapshot -i`, `find role/text/label`, or `frame` |
| Click reported but no change | Overlay, covered target, event not handled, or wrong element | Check `details.overlayBlockers`; re-snapshot; use `find`; inspect with `eval --stdin` |
| `tab_gone` | Bound tab closed | `tab list`, then `tab new <url>` or another tab |
| About:blank after resume | Restored tab lost | `get url`, select the intended tab, re-open if needed |
| Wrong page after an action | Popup or tab drift | `tab list`, select the stable `tN`/target id, `get url`, then snapshot |

## 4. Form errors

| Message or symptom | Cause | Fix |
| --- | --- | --- |
| `fill` succeeds but value empty | Framework-controlled input ignores direct value writes | Focus, then `keyboard type`; verify with `get value` |
| Autocomplete closes immediately | Timing or rerender | Type with a small delay; wait for the option list; re-snapshot |
| `select` has no effect | Native select targeted by option click | Use `select <selector> <value>` |
| Checkbox state unchanged | Clicked a label or hidden input | Use `check`/`uncheck` with a stable selector or current ref |
| Submit did nothing | Validation, overlay, or disabled button | Check visible errors, `get attr ... disabled`, re-snapshot |
| `keyboard inserttext` not reflected in app state | Paste-like insertion bypasses framework events | Use `keyboard type` and verify |

## 5. Artifact errors

| Message or symptom | Cause | Fix |
| --- | --- | --- |
| Screenshot path missing | Relative path resolved against daemon cwd | Use an absolute path; check `details.artifactVerification` |
| `record` pending forever | No `record stop` | Run `record stop` |
| `ffmpeg` missing | Recording dependency absent on the CLI host | Install `ffmpeg` there; a pending recording is not output |
| Download did not appear | Click did not trigger a download, or wrong path | Use `download <selector> <path>` or `wait --download` |
| `artifactVerification` shows `missing` | Command reported success but file absent | Do not claim success; inspect the path and rerun with a verified location |

## 6. Timeouts and aborts

| Message or symptom | Cause | Fix |
| --- | --- | --- |
| Wrapper timeout | Long navigation, heavy page, or slow wait | Increase `timeoutMs`; check `details.timeoutPartialProgress` |
| `waited: "timeout"` | Fixed wait elapsed, condition not proven | Verify with a fresh snapshot or an observed condition |
| Aborted | User cancellation or Pi shutdown | Re-check page state before retrying |
| Batch timed out mid-mutation | Earlier steps may have applied | Inspect current URL and page; do not replay blindly |

## 7. Session and launch errors

| Message or symptom | Cause | Fix |
| --- | --- | --- |
| Launch flags ignored | Session already active | `sessionMode: "fresh"` |
| `managed session outcome` preserved/abandoned | Fresh launch failed before becoming current | Read the outcome, fix the launch cause, retry fresh |
| Tool session and CLI session interfere | Same upstream session name | Direct CLI should use a distinct `--session` |
| `close` fails | Daemon busy or already gone | Retry once; check `session info`; avoid `close --all` unless you own the namespace |

## 8. Remote-host reasoning errors

| Behavior | Why it is wrong | Correct approach |
| --- | --- | --- |
| Assuming page `localhost` reaches Pi | Page runs on the browser host | Use the URL as the page sees it; expose services on that host |
| Passing Pi local file paths to `upload` | File resolves on the browser/CLI host | Place the file on that host, or use page capabilities |
| Expecting a window on the local desktop | Browser may be remote | Verify with screenshot/snapshot, not with window assumptions |
| Treating a tunnel endpoint as local | `127.0.0.1` may be a forwarded port | Reason about the actual browser host, not the endpoint spelling |

## 9. When to stop and report

Stop instead of retrying when:

- the same non-idempotent action (purchase, submit, delete, send) already may have succeeded;
- an endpoint is unreachable after one verification attempt;
- credentials or authorization are missing;
- a CAPTCHA or anti-bot wall appears;
- artifact verification disagrees with the reported success;
- the user's explicit stop boundary is reached.

Report the observed evidence: URL, error category, `nextActions`, artifact state, and what was not attempted.
