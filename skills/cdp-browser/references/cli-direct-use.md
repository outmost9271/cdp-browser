# Direct `agent-browser` CLI use

Use the CLI only when the native tool is a poor fit: raw upstream flags, shell pipelines, `jq`, loops, or reproducing an upstream issue.

## Availability

The extension adds a shim directory to the Pi process PATH at session start:

```bash
command -v agent-browser
agent-browser --version
```

If unavailable:

- confirm the `cdp-browser` extension is loaded in this session;
- confirm the temporary directory is executable (some hardened hosts mount `/tmp` with `noexec`);
- fall back to `cdp_browser` rather than installing a second `agent-browser`.

## What the CLI does not do

Direct calls bypass all wrapper behavior:

- no configured `--cdp` injection
- no managed session
- no `--json` injection
- no ref preflight or page-target validation
- no result categories, `nextActions`, artifact verification, or spill files
- no Pi transcript error patch

## Minimum safe call

```bash
agent-browser --cdp http://127.0.0.1:9222 --session cli-<unique> open https://example.com
agent-browser --cdp http://127.0.0.1:9222 --session cli-<unique> snapshot -i
agent-browser --cdp http://127.0.0.1:9222 --session cli-<unique> close
```

Use a session name that cannot collide with tool-managed sessions. Names beginning with `cdpb-` are reserved by the wrapper; avoid them.

## Endpoint forms

```bash
--cdp http://host:9222
--cdp ws://host:9222/devtools/browser/<id>
--cdp 9222
agent-browser connect http://host:9222
```

Prefer one mode per session. Do not combine `connect`, `--cdp`, `--auto-connect`, and provider flags.

## Structured output

```bash
agent-browser --cdp 9222 --json get title
agent-browser --cdp 9222 --json snapshot -i | jq '.data'
agent-browser --cdp 9222 --json batch --bail < rows.json
```

Check `success` and `error`; do not rely only on the exit code for semantic outcomes.

## Batch from a file

```bash
jq -n '[
  ["open","https://example.com"],
  ["snapshot","-i"],
  ["screenshot","/tmp/example.png"]
]' > /tmp/steps.json

agent-browser --cdp 9222 --json batch --bail < /tmp/steps.json
```

Rules:

- one argv array per row;
- exact `--bail` only;
- absolute artifact paths;
- `get url` before `snapshot -i` after a navigation-prone step when target identity is uncertain;
- never place `record start` after `close` in the same batch.

## Looping over pages

```bash
for url in https://example.com/a https://example.com/b; do
  agent-browser --cdp 9222 --session cli-loop --json open "$url" >/dev/null
  agent-browser --cdp 9222 --session cli-loop --json get title
done
agent-browser --cdp 9222 --session cli-loop close
```

For structured aggregation inside one tool call, prefer `script` instead of a shell loop.

## Passing stdin

```bash
printf '%s' 'document.title' | agent-browser --cdp 9222 eval --stdin
printf '%s' "$SECRET" | agent-browser auth save <name> --password-stdin
```

Never place secrets directly in argv; they appear in process listings and transcripts.

## Reading upstream help and skills

```bash
agent-browser --help
agent-browser <command> --help
agent-browser skills list
agent-browser skills get core --full
agent-browser skills get electron
```

`skills` commands are stateless: they do not need a browser and do not consume the managed session. Prefer `skills get core` first, and only add `--full` when you need the references and templates.

## Cleanup

```bash
agent-browser --cdp 9222 --session cli-<unique> close
agent-browser --cdp 9222 close --all   # only when you own every session in that namespace
```

Leaving sessions open can exhaust tabs, hold the daemon, or keep stale state. Close what you created.

## Full documentation

The package ships a longer guide at `docs/AGENT_BROWSER_CLI.md`. It covers global options, command families, artifacts, state/auth, network diagnostics, error mapping, and the exact correspondence with `cdp_browser` parameters.
