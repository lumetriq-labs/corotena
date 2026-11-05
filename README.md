# Corotena

Swipe through fair tennis doubles pairings.

Each swipe up deals the next round as a court-shaped card; past rounds stack behind it like a wallet. Swipe down (or tap a strip) to go back.

**https://lumetriq-labs.github.io/corotena/**

## Rules

Every round keeps everyone's game count within one of each other. On top of that, pick how to trade sitting out twice in a row against repeating partners:

- **休み連続なし** — nobody sits out two rounds in a row; partners vary as far as that allows
- **バランス** — one more rest in a row counts the same as one more repeat of a pair; the round with the fewest in total wins
- **ペアかぶりなし** — avoid repeating partners; rests in a row are kept down as far as that allows

How the three compare by roster size: [docs/scheduler-stats.md](docs/scheduler-stats.md).

Rounds are chosen by exhaustive search when the number of combinations is small, and by restarted local search otherwise (up to 4 courts).

## Privacy

Members and history are stored only in your browser's `localStorage`. Nothing is sent anywhere.

## Development

```sh
npm install
npm run dev          # local server
npm test             # scheduler and storage unit tests
npm run build        # type-check and build to dist/

# Browser smoke check (uses the locally installed Chrome)
npm run build && npm run preview -- --port 4173 &
npm run check:browser
```

`mock/` holds the original single-file UI mock.

## License

[MIT](LICENSE)
