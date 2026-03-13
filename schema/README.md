# Bertrand Event Schema

`events.schema.json` is the source-of-truth schema for all log events written to `log.jsonl`.

## Go types

Hand-written in `internal/schema/`. Kept in sync manually with the JSON Schema. Validated by tests in `internal/schema/*_test.go`.

## TypeScript types (future)

When building a dashboard or analytics consumer, generate TS types from the schema using [quicktype](https://quicktype.io):

```bash
npx quicktype \
  --src schema/events.schema.json \
  --src-lang schema \
  --lang typescript \
  --out src/types/events.ts \
  --just-types
```

Review the output — quicktype handles string-typed fields and discriminated unions well for TS, unlike Go where we hand-write types.
