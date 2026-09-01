<div align="center">

# Growth Greenhouse

Turn the time you choose to spend learning into a growing place of your own.

**Temporary English name:** Growth Greenhouse

[简体中文](README.zh-CN.md)

![Platform](https://img.shields.io/badge/platform-Windows-4f6f8f)
![Built with Tauri](https://img.shields.io/badge/built%20with-Tauri%20v2-4f7f8f)
![Frontend](https://img.shields.io/badge/frontend-React%20%2B%20TypeScript-3178c6)
![Backend](https://img.shields.io/badge/backend-Rust-b7410e)
[![License](https://img.shields.io/badge/license-MIT-6f647a)](LICENSE)

</div>

Growth Greenhouse is a local-first Windows learning companion. You define something you genuinely want to learn, choose a manageable weekly amount, and connect an optional learning application. The app reads effective foreground time from [Patina](https://github.com/Ceceliaee/patina) and turns that accumulation into plant growth, a growth greenhouse, and personal rewards.

It is intentionally supportive rather than punitive. It does not try to prove whether you were paying attention, force you to study, or make a cloud account mandatory. The goal is to make progress visible enough that you want to return tomorrow.

## The Core Loop

```text
Create a learning goal
        ↓
Choose a weekly target and an optional learning app
        ↓
Patina provides effective foreground activity
        ↓
Every 25 minutes becomes one growth unit
        ↓
The plant grows through stages
        ↓
Completed goals move into your garden

Learning records can also earn water drops: one water drop for each full hour of learning software use or manual learning records. Game software can subtract one water drop for each full hour; unclassified software has no effect. The interface displays the balance with one decimal place, such as `1.0`.
```

One goal becomes one plant. Multiple completed goals become a garden, and the garden is designed to grow into a personal forest over time.

## MVP Features

- Create, pause, resume, and complete multiple learning goals.
- Set weekly and daily targets, a start date, and an optional description.
- Associate one learning application with each active goal.
- Read Patina's `sessions` table through a read-only SQLite connection.
- Refresh the Patina source every 5 seconds and show an explicit connection state.
- Show Patina-style software usage statistics on the Data Source page: today, recent 7 days, recent 30 days, recent year, this week, this month, this year, all time, and custom ranges.
- Show total time, average time, active days, daily/monthly trends, an activity heatmap, application ranking, application trends, and recent sessions.
- Classify applications as learning software, game software, or excluded software. The classification is stored locally and never changes Patina.
- Avoid double-counting overlapping activity intervals for a goal.
- Add manual learning records for study that happens away from the computer.
- Grow plants from seed to sprout, seedling, mature plant, and flowering stages.
- Move completed goals into a persistent growth greenhouse.
- Create ordinary or annual rewards and redeem them with earned water drops.
- Keep goals, manual records, and rewards in the app's own local WebView storage.
- Provide a compact, non-focus-stealing desktop widget for the current goal.

## Privacy And Data

- Growth Greenhouse never writes to the Patina database.
- Patina is opened read-only; the default source is `%APPDATA%\Patina\patina.db`.
- If Patina is unavailable, manual learning records remain available and the UI shows the source as disconnected.
- Goals, manual records, and rewards stay in local browser storage for this MVP.
- No account, hosted backend, telemetry, or cloud sync is required.
- The app records time associated with selected applications; it does not verify learning quality.

For study that happens in a browser, on paper, or outside the computer, use a manual learning record. Manual records contribute to growth and water drops, but do not appear in software usage statistics. Browser-specific activity integration is intentionally deferred until the core loop is validated.


## Build From Source

### Requirements

- Windows 10 or Windows 11
- Node.js 22.5 or newer, because the Vite development adapter uses `node:sqlite`
- [pnpm](https://pnpm.io/installation)
- [Rust](https://www.rust-lang.org/tools/install) and the Tauri v2 prerequisites

### Run The Desktop App

```powershell
git clone https://github.com/Sheniq/Growth-Greenhouse.git
cd Growth-Greenhouse
pnpm install
pnpm tauri:dev
```

### Run The Browser Preview

```powershell
pnpm dev
```

The Vite development server listens on `127.0.0.1:1421` and exposes only the local read-only Patina adapter used by the browser preview. The native Tauri build calls the Rust adapter directly. Software usage statistics are available under the Data Source page.

### Build

```powershell
pnpm build
pnpm tauri:build
```

The Windows NSIS installer is generated under `src-tauri/target/release/bundle/nsis/`. The repository keeps the browser preview source and local API configuration, while build output and personal Patina data remain ignored.

## Project Structure

```text
src/App.tsx          Main greenhouse, garden, rewards, and settings UI
src/Widget.tsx       Compact desktop widget view
src/styles.css       Application and widget styling
src-tauri/src/lib.rs Read-only Patina adapter and native commands
vite.config.ts       Vite preview server and local Patina API
```

The code keeps the integration boundary small: Patina supplies read-only activity sessions, while Growth Greenhouse owns learning goals, manual records, growth, rewards, and presentation.

## Product Boundaries

The first version deliberately does not include AI-generated plans, strong application blocking, commitment deposits, social supervision, payment, cloud sync, or automatic proof that a user studied seriously. These are separate product decisions, not hidden promises of the MVP.

The current product is for people who already want to make progress and would benefit from a visible, low-pressure accumulation loop. It is not intended to be an employee-monitoring system or an unbreakable anti-distraction lock.

## Roadmap

1. Validate the daily loop: goal, learning time, growth, and return visit.
2. Improve plan editing, weekly summaries, and plant-stage feedback.
3. Expand the greenhouse into gardens, forests, themes, and richer annual goals.
4. Add browser activity and other optional learning sources.
5. Consider AI planning or stronger commitment tools only after the local core proves useful.

## Contributing

This is an early personal project. Keep contributions focused on the current local-first scope, preserve the read-only Patina boundary, and avoid adding network dependencies to the core experience. Please include clear reproduction steps for bugs and do not attach personal activity databases or window-title exports to issues.

## License

Growth Greenhouse is released under the [MIT License](LICENSE).
