# Third-party notices

The project code is MIT licensed, copyright 2026 Strateg; see LICENSE.
Third-party code and artwork retain their own rights and licenses.

## Code shipped in the extension

- Zod 4.6.5: MIT, full text in `licenses/zod-LICENSE.txt`.
- @imagemagick/magick-wasm 0.0.43: Apache-2.0, full text in
  `licenses/imagemagick-LICENSE.txt`; upstream ImageMagick and bundled component
  notices are preserved verbatim in `licenses/imagemagick-NOTICE.txt`.
  The unmodified WASM binary is copied from the pinned npm distribution.
- esbuild preserves bundled legal comments and accompanying `.LEGAL.txt` files.

Build tools are pinned in package-lock.json and installed through npm ci.
Their licenses remain in their npm packages; they are not relicensed by this project.
Development dependency license copies remain in the repository under
`licenses/build-tools/`; they are excluded from release archives. The lockfile
preserves dependency metadata and integrity hashes. npm ci restores the original
packages and licenses.

## CtrlEm artwork

Reference: [native CtrlEm gamepad](https://ctrlem.com/images/logo.png), retrieved
2026-09-27 from [CtrlEm](https://ctrlem.com/). The original is retained in the repository as
`assets/branding/ctrlem-original.png`. The DB adaptation was generated using
OpenAI imagegen; its master and prompt are retained in the repository. Release
archives include only the PNG sizes used by the extension.

The project MIT license does not grant rights to the original CtrlEm artwork or
trademark. This is an unofficial extension by Strateg, not a claim of CtrlEm
endorsement. A redistribution license/permission for the native mark has not been
established in this task; confirm permission before public distribution.
