# First-install evidence

INSTALL1 installs the base only. INSTALL2 starts in a separate clean folder and adds
available female bundles. INSTALL3 starts in a third clean folder and adds available
male quest dialogue and answer bundles. Missing future bundles and missing transport
coverage stay explicitly unavailable; recording/text fallbacks keep working.

Build only from the exact passing candidate receipt and matching main ZIP. Freeze
available voice ZIPs and transport shards with `scripts/installer_downloads.py`:

```
python3 scripts/installer_downloads.py --transport EXTERNAL_SHARD_ROOT \
  --packs dist/packs --output dist/installer --version 0.11.0 \
  --source-commit EXACT_COMMIT --candidate-zip EXACT_CANDIDATE_ZIP \
  --base-url https://github.com/mliudev/LoreForever/releases/download/v0.11.0/
```

The consumer checks receipt hashes, dependencies and versions, builds each declared
shard ZIP under 480 MB, and binds real archive SHA/URL plus source/candidate identity.
It preserves producer coverage fields. Only `rates: ['1']` resume segments are
accepted; alternate prerecorded speeds are disabled. Every segment byte hash is
checked against the receipt, and undeclared audio is refused. Only selected sources and their required shards
are compiled into automatic downloads; other languages are available in JSON.
`--published-transport release/transport-downloads.json` fetches already published,
SHA-bound shards for the public workflow. No manifest means existing recording fallback.
Publishing transport assets/metadata is separate authorized release work.

Copy these QA helpers into `C:\Users\Mike\LoreForeverQA\tools` and run
`build-qa-setup.ps1 -CandidateDirectory DIR -SourceCommit SHA -DownloadDirectory DIR`.
It verifies the companion source still matches the existing isolated companion build.
Then serve DownloadDirectory on localhost and run
`test-qa-setup.ps1 -BuildDirectory DIR -VoiceBase http://127.0.0.1:PORT/`.
Each journey checks actual selected downloads, SHA receipts, installed bytes, versions,
dependencies and absence of other options. The report stores independent passed,
failed or untested states; unavailable options are untested, never a fabricated pass.
Normal Windows entries/processes/files are compared before and after. `/QA` keeps all
writes in scratch and suppresses normal integration and app launch.

For incomplete-byte rejection, serve a copy with the female ZIP truncated and run
`test-retry.ps1` against an already verified isolated female journey, using
`-TruncatedBase` for that server and `-VoiceBase` for the complete archives. It checks
failed exit/receipt, preservation of working female bytes, and correct retry bytes.
This is a static incomplete-download fixture, not proof of live network interruption.
`test-prune.ps1` creates owned, unknown and unselected scratch sentinels and proves successful refresh removes
only an old selected source generation while preserving an unselected language shard and unrecognized folders. Owned obsolete folders move atomically outside AddOns before cleanup, so partial deletion cannot leave an old generation loadable. Failed retirement is reported; failed backup cleanup preserves a non-loadable backup.

Silent fixture tests do not prove the visible installer flow, final candidate release
assets, first login, or audible game playback. Those evidence types stay separate.

Folder replacement preserves unrestored backups and stops subsequent downloads when recovery is pending. The promotion-failure/rollback/retry fixture still requires separate evidence; a successful clean install or incomplete-byte retry does not prove that path.
