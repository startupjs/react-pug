# @react-pug/check-types

Type-check React-Pug projects through the TypeScript language-service plugin, from the CLI or as a library.

## Install

```bash
npm i -D @react-pug/check-types
```

## CLI

```bash
npx @react-pug/check-types
npx @react-pug/check-types .
npx @react-pug/check-types src/App.tsx src/Button.tsx
npx @react-pug/check-types --project tsconfig.json
```

Supported options:

- `-p, --project <path>`: explicit `tsconfig.json` file or directory
- positional file paths: check only selected files while still using the full project context
- `--tagFunction <name>`: tag function name, default `pug`
- `--injectCssxjsTypes <never|auto|force>`: cssxjs/startupjs React prop injection mode

Default behavior mirrors `tsc` closely:

- if `--project` is omitted, the checker searches upward from the target directory for the nearest `tsconfig.json`
- diagnostics are printed against original source locations, including Pug regions
- process exits with code `1` when errors are found

## Library

```js
import { checkTypes } from '@react-pug/check-types'

const result = await checkTypes({ cwd: process.cwd() })
if (!result.ok) {
  for (const line of result.formattedErrors) console.error(line)
}
```

Useful exports:

- `checkTypes(options)`
- `runCli(argv, io?)`
- `parseArgs(argv)`

Published binary:

- `check-pug-types`

## Notes

The checker tries to use the target project's local `typescript` first and falls back to the package dependency if none is available.
