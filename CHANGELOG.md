# Changelog

All notable changes to this project will be documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/2.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.5.2] - 2026-09-05
### Fixed
- Refreshed daemon-managed documents after external edits so subsequent LSP queries use current file contents.
- Prevented stale diagnostics from being reused after a document change, including when the updated diagnostic set is empty.

## [1.5.1] - 2026-07-01
### Changed
- Clarified when `text` is the default fit and when `--format json` helps structured follow-up.
- Reworked bundled agent docs to keep text output as the primary reading path.

### Fixed
- Preserved complete edit payloads in text previews for `format`, `rename`, and `code-actions`.
- Fixed `format` text output so array-style text edits are reported correctly.

[Unreleased]: https://github.com/frostime/simple-lsp-cli/compare/v1.5.2...HEAD
[1.5.2]: https://github.com/frostime/simple-lsp-cli/compare/v1.5.1...v1.5.2
[1.5.1]: https://github.com/frostime/simple-lsp-cli/compare/v1.5.0...v1.5.1
