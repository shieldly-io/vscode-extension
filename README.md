# Shieldly — AI-Powered Security Analyzer for AWS (VS Code)

Analyze AWS IAM policies and CloudFormation templates **as you write them**,
without leaving your editor. Inline risk squiggles, a security score in the
status bar, and a full results panel. Powered by
[Shieldly](https://www.shieldly.io).

## Install

Search **"Shieldly"** in the VS Code Marketplace, or:

```
ext install shieldly.shieldly
```

## Usage

1. Open any `.json`, `.yaml`, or `.yml` file containing an IAM policy or
   CloudFormation template.
2. Run **Shieldly: Run AI-Powered Analysis** from the editor toolbar, the
   right-click menu, or the Command Palette.
3. See inline squiggles on risky lines plus a full results panel.

## Commands

| Command | Description |
| --- | --- |
| `Shieldly: Run AI-Powered Analysis` | Analyze the current file |
| `Shieldly: Set API Key` | Store your `sk_live_...` key |
| `Shieldly: Clear API Key (reset to demo)` | Remove the stored key |
| `Shieldly: Show Last Result` | Reopen the last results panel |

Without an API key, the extension runs in limited demo mode. Get a key at
[shieldly.io/app/api](https://www.shieldly.io/app/api).

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `shieldly.apiUrl` | `https://api.shieldly.io` | API base URL (override for dev). |
| `shieldly.autoAnalyze` | `false` | Automatically analyze JSON files on open. |

## Privacy

Shieldly does **not** log your policy input. Cache keys are one-way SHA-256
hashes.

## Links

- Web app & demo: https://www.shieldly.io
- API reference: https://www.shieldly.io/docs/api

## Free tools & references (no signup)

No account required — these run in your browser or document the risks:

- [IAM Privilege Escalation Cheat Sheet](https://www.shieldly.io/iam/cheatsheet?utm_source=github&utm_medium=readme) — every common escalation path on one page, with fixes
- [Free browser tools](https://www.shieldly.io/tools?utm_source=github&utm_medium=readme) — IAM policy linter, trust policy explainer, S3 bucket policy checker, CloudFormation IAM checker
- [IAM privilege escalation reference](https://www.shieldly.io/iam?utm_source=github&utm_medium=readme) — each method with a vulnerable policy, the exploit, and the fix

## License

MIT © Shieldly

---

*Amazon Web Services (AWS) is a trademark of Amazon.com, Inc. Shieldly is not
affiliated with, endorsed by, or sponsored by Amazon Web Services.*
