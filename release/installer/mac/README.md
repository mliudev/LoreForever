# Install Lore Forever for Mac

The Mac twin of `LoreForever-Setup.exe` (LOR-1348). One window, one button; the design page is the spec.

- `Sources/` the app: Swift, no third-party code. Reads the site's `/api/installer/catalog` (the Downloads page's cards with
  their exact ZIPs), so it doesn't change with add-on releases.
- `build.sh` builds the app and `.dmg`; `release.sh` signs, notarizes and checks Gatekeeper. `qa/qa.py` drives real installs
  against a local server (`build.sh --qa`, on a Mac).
- The pick from the site travels in the file name, as Setup's does: `/download/mac/<narrator>/<lang>/<bundle>` serves
  the one notarized `.dmg` as `Install Lore Forever (female, de, storyteller).dmg`.
- Published by the public repo's Mac Installer workflow on the `mac-installer` release. The site's Mac flip is separate.

macOS rules this follows: no listing inside an external disk (macOS would ask permission; it checks known paths only),
and the `.dmg` is ejected but left in Downloads, since moving it to the Trash makes macOS show a permission box.
