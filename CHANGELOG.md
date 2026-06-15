# Changelog

## [0.22.0](https://github.com/uiid-systems/bertrand/compare/v0.21.0...v0.22.0) (2026-06-15)


### Features

* session effectiveness rating (+ taxonomy slash-segment refactor) ([#131](https://github.com/uiid-systems/bertrand/issues/131)) ([c91a648](https://github.com/uiid-systems/bertrand/commit/c91a648faf549bfe99fcaf10902b8a36f636c44a))


### Refactoring

* **taxonomy:** treat first slash-segment as category, rest as slug ([#129](https://github.com/uiid-systems/bertrand/issues/129)) ([4d9ec6c](https://github.com/uiid-systems/bertrand/commit/4d9ec6cd42f4bce84e5b26c573f72f1ba4d39647))

## [0.21.0](https://github.com/uiid-systems/bertrand/compare/v0.20.1...v0.21.0) (2026-06-15)


### Features

* **cli:** project-aware log/list output ([#125](https://github.com/uiid-systems/bertrand/issues/125)) ([0b3da49](https://github.com/uiid-systems/bertrand/commit/0b3da492eda388fed9f036b107b462e5bda4992d))


### Bug Fixes

* **tui:** bulletproof session exit + Warp blank-screen ([#127](https://github.com/uiid-systems/bertrand/issues/127)) ([2084e81](https://github.com/uiid-systems/bertrand/commit/2084e81e9860cc494cd18370dee16c07348ec884))

## [0.20.1](https://github.com/uiid-systems/bertrand/compare/v0.20.0...v0.20.1) (2026-06-15)


### Bug Fixes

* **tui:** release revert of [#116](https://github.com/uiid-systems/bertrand/issues/116) to clear simultaneous-input warning ([f51a82f](https://github.com/uiid-systems/bertrand/commit/f51a82ffd1422e18e8f791bfd24ad2dccbedb8d9))

## [0.20.0](https://github.com/uiid-systems/bertrand/compare/v0.19.0...v0.20.0) (2026-06-15)


### Features

* **events:** capture assistant.message per turn, not just at Stop ([#121](https://github.com/uiid-systems/bertrand/issues/121)) ([874e2a1](https://github.com/uiid-systems/bertrand/commit/874e2a194a0d6b17fd4d3b40a0211947e227b8c5))
* **events:** tool.used captures every Claude tool call ([#120](https://github.com/uiid-systems/bertrand/issues/120)) ([101326b](https://github.com/uiid-systems/bertrand/commit/101326b50ac220d60a557bb778006bea2bb68bbe))


### Bug Fixes

* **dashboard:** stop auto-started server before bun dev ([#115](https://github.com/uiid-systems/bertrand/issues/115)) ([e969efe](https://github.com/uiid-systems/bertrand/commit/e969efed97b79b780461fb73b9deb254a6dae845))
* **hooks:** silence internal stderr + recover from migration race ([#118](https://github.com/uiid-systems/bertrand/issues/118)) ([3591396](https://github.com/uiid-systems/bertrand/commit/3591396dc79b1c967676d34713277fa457139d5b))
* **tui:** collapse project-picker + launch into one Storm app ([#116](https://github.com/uiid-systems/bertrand/issues/116)) ([a644383](https://github.com/uiid-systems/bertrand/commit/a64438318432cfedf71b991e938148da62f307af))


### Refactoring

* **events:** single-source typed emit helpers ([#119](https://github.com/uiid-systems/bertrand/issues/119)) ([be3e94a](https://github.com/uiid-systems/bertrand/commit/be3e94af4e0dcb60c558129cc61fc397d5479098))

## [0.19.0](https://github.com/uiid-systems/bertrand/compare/v0.18.0...v0.19.0) (2026-06-15)


### ⚠ BREAKING CHANGES

* **db:** project-scope the Drizzle connection ([#108](https://github.com/uiid-systems/bertrand/issues/108))
* **projects:** `bertrand list --group` is now `--category`. The `session.started` event meta key `group_path` is now `category_path` — historical events keep the old key, the dashboard event-title fallback only reads the new one.
* `bertrand list --group` is now `--category`. The `session.started` event meta key `group_path` is now `category_path` — historical events keep the old key, the dashboard event-title fallback only reads the new one.

### Features

* **cli:** add bertrand project subcommands ([#112](https://github.com/uiid-systems/bertrand/issues/112)) ([6b18ef7](https://github.com/uiid-systems/bertrand/commit/6b18ef7001b739374fd635c391591aea15d84005))
* **engine:** inject BERTRAND_PROJECT into the Claude spawn env ([#111](https://github.com/uiid-systems/bertrand/issues/111)) ([3dbb320](https://github.com/uiid-systems/bertrand/commit/3dbb320fd1f267f8715227c7d3670878c47b1f3f))
* **projects:** add project registry + path resolver ([#107](https://github.com/uiid-systems/bertrand/issues/107)) ([849ce76](https://github.com/uiid-systems/bertrand/commit/849ce763238fbe8cef8ac438996973096ac4b650))
* **projects:** migrate legacy single-DB layout to projects/default ([#109](https://github.com/uiid-systems/bertrand/issues/109)) ([bd06557](https://github.com/uiid-systems/bertrand/commit/bd06557df9dec2c039cd2713ee799588eab667fc))
* **sync:** per-project sync + invite bundle v2 ([#114](https://github.com/uiid-systems/bertrand/issues/114)) ([1de27d0](https://github.com/uiid-systems/bertrand/commit/1de27d0f18ea35601d6ef2b8ec72c862f9cd40d4))
* **tui,dashboard:** project picker + dashboard project switcher ([#113](https://github.com/uiid-systems/bertrand/issues/113)) ([4f4c756](https://github.com/uiid-systems/bertrand/commit/4f4c7561287570a7aa28f8d620769bb2df133f7a))


### Bug Fixes

* **engine:** finalize session on abrupt bertrand exit ([#104](https://github.com/uiid-systems/bertrand/issues/104)) ([1d005e3](https://github.com/uiid-systems/bertrand/commit/1d005e315dd8166c7adb4600bfe5148ff5a45332))


### Refactoring

* **db:** project-scope the Drizzle connection ([#108](https://github.com/uiid-systems/bertrand/issues/108)) ([7ab8426](https://github.com/uiid-systems/bertrand/commit/7ab842674227d641ed964bb58be4e7696f3a9f23))
* rename groups → categories ([#106](https://github.com/uiid-systems/bertrand/issues/106)) ([ac7cf35](https://github.com/uiid-systems/bertrand/commit/ac7cf35690ba594203fabb0c945afded2ee22c2f))


### Miscellaneous

* force release-please to 0.19.0 ([fe7eed5](https://github.com/uiid-systems/bertrand/commit/fe7eed52c2414b5eed1574365f22bc9bd0d5517f))

## [0.18.0](https://github.com/uiid-systems/bertrand/compare/v0.17.0...v0.18.0) (2026-06-13)


### Features

* **sync:** opt-in Supabase Storage sync with E2E encryption ([#101](https://github.com/uiid-systems/bertrand/issues/101)) ([8e2bafa](https://github.com/uiid-systems/bertrand/commit/8e2bafa9eacc095663b1cbab670d98368c581fbd))

## [0.17.0](https://github.com/uiid-systems/bertrand/compare/v0.16.0...v0.17.0) (2026-06-12)


### Features

* **tui:** archive sessions from the launch screen ([#99](https://github.com/uiid-systems/bertrand/issues/99)) ([6486f0b](https://github.com/uiid-systems/bertrand/commit/6486f0b0646f9844cce16bdd70a390dc51f79f06))

## [0.16.0](https://github.com/uiid-systems/bertrand/compare/v0.15.0...v0.16.0) (2026-06-12)


### Features

* **server:** auto-start API server with first session, stop with last ([#98](https://github.com/uiid-systems/bertrand/issues/98)) ([ef48696](https://github.com/uiid-systems/bertrand/commit/ef48696d17f8e64593e38fcc2318050ebf5e5154))


### Bug Fixes

* **vercel:** simplify rewrites and drop framework override ([#96](https://github.com/uiid-systems/bertrand/issues/96)) ([8fa8b99](https://github.com/uiid-systems/bertrand/commit/8fa8b9971aa16d2b26825c72d5d1ed0c23a7646c))

## [0.15.0](https://github.com/uiid-systems/bertrand/compare/v0.14.1...v0.15.0) (2026-06-10)


### Features

* **archive:** share archive policy across CLI, TUI, server, and dashboard ([#88](https://github.com/uiid-systems/bertrand/issues/88)) ([e6e965e](https://github.com/uiid-systems/bertrand/commit/e6e965e9fc90db7c1c87e1e285969098fd8bca52))
* **dashboard:** copy resume command from sidebar and session detail ([#92](https://github.com/uiid-systems/bertrand/issues/92)) ([6032bc0](https://github.com/uiid-systems/bertrand/commit/6032bc0f903a84e2e6decb7dfb561c7b46d0b2f9))
* **dashboard:** sticky timeline footer with status, pending question, and context stats ([#93](https://github.com/uiid-systems/bertrand/issues/93)) ([1371834](https://github.com/uiid-systems/bertrand/commit/1371834e26616e82c2c95d26fb3b077a85996ed0))
* **tui:** list paused/waiting sessions on launch ([#91](https://github.com/uiid-systems/bertrand/issues/91)) ([560dc3e](https://github.com/uiid-systems/bertrand/commit/560dc3efbbffbe686693058176264f2b4fe7f0c4))


### Bug Fixes

* **hooks:** enforce multiSelect mechanically; trim soft-rule template ([#89](https://github.com/uiid-systems/bertrand/issues/89)) ([0d4b879](https://github.com/uiid-systems/bertrand/commit/0d4b879419ef364de41af673511d485c66501d78))

## [0.14.1](https://github.com/uiid-systems/bertrand/compare/v0.14.0...v0.14.1) (2026-05-21)


### Refactoring

* **contract:** strengthen multiSelect enforcement on AskUserQuestion ([#86](https://github.com/uiid-systems/bertrand/issues/86)) ([62ae69b](https://github.com/uiid-systems/bertrand/commit/62ae69b147114c51de0d549b381b96fcf191fa42))

## [0.14.0](https://github.com/uiid-systems/bertrand/compare/v0.13.0...v0.14.0) (2026-05-16)


### ⚠ BREAKING CHANGES

* **dist:** rename npm package from @uiid/bertrand to bertrand

### Features

* **contract:** expose sibling sessions via bertrand log --json ([405ef9f](https://github.com/uiid-systems/bertrand/commit/405ef9f4204f8cea6ecae770482048cd75250ccd))
* **dist:** rename npm package from @uiid/bertrand to bertrand ([690b555](https://github.com/uiid-systems/bertrand/commit/690b555d90754939ebe85529b43436fefcd4b2be))


### Refactoring

* tinkering ([33a05d2](https://github.com/uiid-systems/bertrand/commit/33a05d2d1b540570afe4cdcb744267f330b2791c))


### Miscellaneous

* release 0.14.0 ([26b5fa6](https://github.com/uiid-systems/bertrand/commit/26b5fa663abddffa340da9037915488e4d659da5))

## [0.13.0](https://github.com/uiid-systems/bertrand/compare/v0.12.0...v0.13.0) (2026-05-12)


### Features

* **dashboard:** action buttons on session-start CWD row ([d41aaf4](https://github.com/uiid-systems/bertrand/commit/d41aaf49df39bd53133bf6a89e318c1e2e4305e9))
* **dashboard:** link session-start CWD to cursor://file ([54bf9c2](https://github.com/uiid-systems/bertrand/commit/54bf9c289f92f6a005d0b6ee8993b991dacc8d6a))
* **dashboard:** richer session-started timeline card ([6874b98](https://github.com/uiid-systems/bertrand/commit/6874b989f7ffd68f8c08da0a7acbb26683831ac6))
* **dashboard:** use session identity as session-started timeline title ([0162a3d](https://github.com/uiid-systems/bertrand/commit/0162a3d7160ce983ffd00d6e2fce92b0e1edafa9))
* **engine:** capture spawn context for session start events ([60909dc](https://github.com/uiid-systems/bertrand/commit/60909dc51a6936136ff87ce45dedf4e09081b20f))
* **server:** add POST /api/open for opening paths ([ad631b9](https://github.com/uiid-systems/bertrand/commit/ad631b954f76c070107e04771f2cc564863b3f4e))


### Bug Fixes

* **dashboard:** parse AUQ picks from answer string for Claude Code 2.1.123+ ([6ede5a0](https://github.com/uiid-systems/bertrand/commit/6ede5a0bf7e766f053a48a8eb4ca937de3227100))


### Refactoring

* **dashboard:** move session stats into right-side sheet ([666c12f](https://github.com/uiid-systems/bertrand/commit/666c12fd3ba732af7af4b8bd1d74fb85c04b3236))
* tinkering ([e90858d](https://github.com/uiid-systems/bertrand/commit/e90858d8231f4f1ee1245786debb25303a8357ae))

## [0.12.0](https://github.com/uiid-systems/bertrand/compare/v0.11.0...v0.12.0) (2026-05-11)


### Features

* **dashboard:** status-gated polling for streaming timeline ([bf3c31a](https://github.com/uiid-systems/bertrand/commit/bf3c31a626e18af2be7bc335cdbc98f0ddf18fae))

## [0.11.0](https://github.com/uiid-systems/bertrand/compare/v0.10.1...v0.11.0) (2026-05-11)


### Features

* **sidebar:** show session recaps in popover from metadata row ([bf41788](https://github.com/uiid-systems/bertrand/commit/bf41788d5c5a3e329c6fbf8834ce4c4e533274c1))
* **sidebar:** three-axis grouping with inline diff stats ([53b5ce0](https://github.com/uiid-systems/bertrand/commit/53b5ce0837696b98210e2b9d58cb48b199a6b63f))
* **timeline:** capture inter-AUQ thinking recaps ([74c9d9c](https://github.com/uiid-systems/bertrand/commit/74c9d9c0e46fab0332d709d1904cf03942fe4f13))
* **timeline:** render assistant.recap as its own row ([828ecd3](https://github.com/uiid-systems/bertrand/commit/828ecd36f2e62799491b10e1a74000d9327e6d20))
* **tui:** polish create picker with group counts and badged "+ new" ([f998819](https://github.com/uiid-systems/bertrand/commit/f9988194d7e6281b2fdfcdd7c505b91090049727))
* **tui:** rebuild launch screen as create-first wizard ([1f1e102](https://github.com/uiid-systems/bertrand/commit/1f1e1028645ca1c3e6d18df349981984a2f76d9a))


### Bug Fixes

* **timeline:** preserve Q&A merge when assistant.recap interleaves ([56caf7f](https://github.com/uiid-systems/bertrand/commit/56caf7f073d2be2f5b8449c553d23659387e7791))
* **timeline:** treat Other-only AUQ answers as manual, not "Didn't answer" ([1af4dc1](https://github.com/uiid-systems/bertrand/commit/1af4dc15b8e0d6c5ea87f86e06f7fc38b9131142))


### Refactoring

* sidebar tinkering ([0336508](https://github.com/uiid-systems/bertrand/commit/03365086ce39a8a28a6f8cea4ee80ffea354a06f))

## [0.9.1](https://github.com/uiid-systems/bertrand/compare/v0.9.0...v0.9.1) (2026-04-07)


### Bug Fixes

* **brew:** strip quarantine attribute on install and upgrade ([#67](https://github.com/uiid-systems/bertrand/issues/67)) ([b617e97](https://github.com/uiid-systems/bertrand/commit/b617e9799a9c9a96856d01ff36a50b7a13a5b81b))
* register MCP server in ~/.claude.json instead of settings.json ([#69](https://github.com/uiid-systems/bertrand/issues/69)) ([a658eee](https://github.com/uiid-systems/bertrand/commit/a658eeefdc76244a4ab77c2166328c28c5680224))


### Refactoring

* **contract:** decouple session summary from direct file write ([#70](https://github.com/uiid-systems/bertrand/issues/70)) ([a2d992e](https://github.com/uiid-systems/bertrand/commit/a2d992e807d7b84d0e5631b20ccdf04585d4ffa5))
* **dashboard:** remove editing features ([#71](https://github.com/uiid-systems/bertrand/issues/71)) ([5fad3e3](https://github.com/uiid-systems/bertrand/commit/5fad3e38f244f70932e85f9725771870a8c517e7))

## [0.9.0](https://github.com/uiid-systems/bertrand/compare/v0.8.1...v0.9.0) (2026-04-03)


### Features

* MCP server and enriched sibling context ([#65](https://github.com/uiid-systems/bertrand/issues/65)) ([416c71e](https://github.com/uiid-systems/bertrand/commit/416c71ef83eb0147409b7b3e474d1b60765f0d20))
* on-demand worktree preview with Portless ([#62](https://github.com/uiid-systems/bertrand/issues/62)) ([82b2982](https://github.com/uiid-systems/bertrand/commit/82b298294079473ba8d216f4d13293df112e5427))
* replace session timeline with concise recap at exit ([#66](https://github.com/uiid-systems/bertrand/issues/66)) ([9169ded](https://github.com/uiid-systems/bertrand/commit/9169ded03d98ca7053eabe733711eaf44021f619))
* **server:** serve dashboard from filesystem in dev mode ([#57](https://github.com/uiid-systems/bertrand/issues/57)) ([9d87b37](https://github.com/uiid-systems/bertrand/commit/9d87b37d057caefe210b2c7f1771ceb05c09969e))
* **web:** add worktrees tab with per-file diff stats ([e38343b](https://github.com/uiid-systems/bertrand/commit/e38343b9a257d98ffa36f3e4ba4be66c5abec14c))
* **web:** show active worktrees in dashboard ([#56](https://github.com/uiid-systems/bertrand/issues/56)) ([747165b](https://github.com/uiid-systems/bertrand/commit/747165bff8bcccb05b0f964dc71916349dd94c1c))


### Bug Fixes

* auto-update settings.json and completions on hook staleness ([#64](https://github.com/uiid-systems/bertrand/issues/64)) ([fb6862d](https://github.com/uiid-systems/bertrand/commit/fb6862d9320bb165ff97d1a3fb1c6b6667ad9d6a))
* **hooks:** export env vars so python3 receives them across pipe ([#55](https://github.com/uiid-systems/bertrand/issues/55)) ([b32d740](https://github.com/uiid-systems/bertrand/commit/b32d740ecb1b976fc480ebe1fdd8f0d36c103336))
* use PAT for release-please and align web version ([7e8a148](https://github.com/uiid-systems/bertrand/commit/7e8a14874b29f8b9ecc83d070afbf73d2124bf5b))
* **web:** preserve worktree accordion open state across refetches ([fe8232b](https://github.com/uiid-systems/bertrand/commit/fe8232b27566aff52caf4d7a377dd90ab61f2e06))
* **web:** preserve worktree accordion open state across refetches ([8949f0c](https://github.com/uiid-systems/bertrand/commit/8949f0ca9e5afe9c0f1cf5321da6f437646a144b))


### Refactoring

* remove focus-stealing functionality ([#63](https://github.com/uiid-systems/bertrand/issues/63)) ([74bf87e](https://github.com/uiid-systems/bertrand/commit/74bf87e81bc7d651d9886ae96cc8765c27c2b904))
* uiid stuff ([a662258](https://github.com/uiid-systems/bertrand/commit/a662258a9adac09a9b0ef3ff4f60210b0d809ffc))
* uiid stuff ([cabd4e4](https://github.com/uiid-systems/bertrand/commit/cabd4e4a32d010a1caa10d0641ee6cedb0d55ca2))
* **web:** migrate badge, button, and tooltip to design-system ([cbb10dd](https://github.com/uiid-systems/bertrand/commit/cbb10dd4cea1e5fa39a33c4bb1207ec5f005177c))
