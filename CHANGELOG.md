# Change Log

## 0.1.4 (2026-06-15)

### Changed
- Repository URL updated to the dedicated public mirror: `github.com/shieldly-io/vscode-extension`

## 0.1.3 (2026-06-15)

### Added
- CloudFormation findings now show a prominent **Solution** section (blue left-border card) with remediation text
- Enterprise AI responses include an **AI-Generated Fix** section with a corrected policy/template and a one-click copy button

### Fixed
- Broken docs links inside the results panel (`/docs` and `/docs/findings`) now point to the live API reference at `/docs/api`
- API key is now read from a login shell as a fallback, so `SHIELDLY_API_KEY` set in `~/.zshrc` is picked up when VS Code is launched from the Dock or Spotlight

## 0.1.2 (2026-06-14)

### Added
- CloudFormation template analysis now available in demo mode — no API key required for basic CloudFormation checks
- YAML CloudFormation templates (`.yaml`, `.yml`) fully supported alongside JSON
- Results panel: score animation, elapsed-time display, and a close button

### Fixed
- IAM User and Group resources now correctly detected in CloudFormation templates (false-negative fix)
- `Scan Directory` no longer misidentifies demo-mode users and blocks the scan
- Demo analysis count now reflects the server-authoritative remaining count instead of a hardcoded value
- Demo credits are no longer consumed on cache hits — repeated identical policies only count once
- Corrected demo limit messaging: accurate copy, signup call-to-action, and proper batch analysis cutoff
- All emoji icons replaced with inline SVG for consistency with the rest of the UI

## 0.1.1 (2026-06-13)

### Fixed
- Large CloudFormation templates (>25 KB) no longer rejected with "Input exceeds 25,000 chars" — CF templates now use the correct 600 KB limit
- Analyze command now works from the Explorer file tree (right-click → Shieldly: Run AI-Powered Analysis)

## 0.1.0 (2026-06-13)

### Added
- AI-Powered Security Analysis for AWS IAM policies and CloudFormation templates
- Inline squiggles for CRITICAL (red) and HIGH (orange) findings
- Security score in status bar
- Full results panel with findings, score, and remediation hints
- Demo mode (5 free analyses, no signup required)
- API key storage via VS Code SecretStorage
