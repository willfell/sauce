
I want to make sure that we get blueprints like 
- Finance
	- Personal Finance Like we have within the Headspace Vault
		- `/Users/willfell/Documents/obsidian/sync/headspace/Finance/Finance.md`
		- This is for managing budgets, paychecks, what you made in what pay period, what bills did you pay off, indications that you still have things to pay, etc. 
	- Business finance like we have within the ERO vault 
		- `/Users/willfell/Documents/obsidian/sync/ero/Finance/Finance-Hub.md`
		- I believe, that we
	- I believe that we can incorporate one financial blueprint that can handle the day to day budgeting / paycheck tracking, as well as have an "invoicing" system, which is pretty much ERO's way of doing things. 

## Multi-theme support — soon

Foundation for shipping multiple presets so adding more in the future is mechanical.

Source vaults to vendor + canonicalize Style Settings JSON from:
- Current Baseline (already shipped in v0.19.0; rose-pine-light light / melange-dark dark / Inter font)
- Headspace vault: `/Users/willfell/Documents/obsidian/sync/headspace/CLAUDE.md` — read CLAUDE.md to identify which theme + its Style Settings config
- ERO vault: `/Users/willfell/Documents/obsidian/sync/ero/Boards` — inspect `.obsidian/themes/` + `.obsidian/plugins/obsidian-style-settings/data.json` for vendoring
- One more for variety (TBD — picked from accuris or a fresh community theme)

Schema upgrade (v0.19.0 design Section 4 out-of-scope item):
- `style_settings_defaults_src` (single string) → `style_presets[]` keyed by name
- Each preset entry: `{ name, theme_src, style_settings_src, appearance_overrides }`
- Consumer subscription declares `style_preset: "baseline"` (or "headspace" / "ero" / "<fourth>")
- Wizard adds a preset-select prompt during first-run

Cycle shape estimate: v0.22.0 MINOR (or v0.21.x if bundled into the bootstrap cycle's polish).
