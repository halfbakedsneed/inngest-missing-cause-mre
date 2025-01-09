# `inngest-missing-cause-mre`

MRE showcasing various deficiencies of the `onFailure` input payload:

- `event.data.error` is missing the `cause` property.
- `result` (which _does_ include a `cause`) is missing from the top-level payload.

## Reproducing

1. `pnpm i`
2. In one terminal, run `pnpm start`
3. In another terminal, run `pnpm reproduce` - observe the console output.
