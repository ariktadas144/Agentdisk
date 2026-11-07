# Website assets

The interactive report is an illustration with fictional folders and sizes.
No visitor's disk is scanned or cleaned. Only rebuildable example rows can be
selected; protected and shared rows remain outside the example plan.

The actual application remains a CLI and MCP server. The real recording
`../demo.gif` shows sample projects, as described in the project README.

`logo.svg` in the parent directory is the drive icon. The social image and PNG
icons are rendered from `social-preview.html` and that SVG. The site browser
check renders these assets in CI, verifies report arithmetic and controls,
tests narrow viewports, and keeps the no-JavaScript fallback readable.

The Rust workspace and its dependency-free design are unchanged.
