# Improvements Backlog

## Partial Pug Prop Completion Should Insert Full Snippet

### Problem

In pug attribute lists, accepting a component prop completion after partially typing the prop name does not insert the same full snippet shape that JSX does.

Example:

```pug
Card(t)
```

Current behavior after accepting `title`:

```pug
Card(title)
```

Desired behavior:

```pug
Card(title='')
```

with the cursor placed inside the quotes, matching JSX behavior for string props.

This issue does **not** affect the case where the completion is accepted from an empty attribute slot:

```pug
Card()
```

In that case, completion already inserts the correct `title=''` form.

### Reproduction

Use [`example/src/App.tsx`](/Users/cray0000/ws/www/vscode-pug-react/example/src/App.tsx).

Inside a pug block:

```pug
Card(t)
```

Then trigger or accept completion for `title`.

### What Was Confirmed

The problem is **not** in the core pug-to-TSX transform.

The problem is also **not** that TypeScript fails to understand the prop type.

Raw TS plugin inspection showed that for the partial-typed pug case, the plugin already returns the correct completion metadata:

- completion entry name: `title`
- `insertText: "title='$1'"`
- `replacementSpan` covering the typed `t`
- `isSnippet: true`

So at the plugin boundary, the completion data is already correct.

### Important Comparison Result

Plain TypeScript language service output for real JSX does **not** itself contain the final `=''` snippet either.

That strongly suggests this behavior is added later by VS Code’s built-in TypeScript extension, based on JSX context.

Implication:

- JSX snippet insertion is not coming directly from raw `tsserver` completion entries alone
- VS Code is likely recognizing JSX attribute context and applying extra completion shaping internally
- our mapped pug completion path is losing that contextual recognition somewhere between tsserver output and final editor completion application

### What Was Tried

#### 1. TS Plugin-side snippet enrichment

The TS plugin was extended to attach:

- `insertText`
- `replacementSpan`
- `isSnippet`

for partial pug prop completions.

Result:

- raw plugin output was correct
- VS Code still surfaced only plain `title`

Conclusion:

- VS Code’s final completion application did not honor this metadata in the pug-mapped case

#### 2. VS Code extension workaround using a parallel completion provider

A custom completion provider was added in the extension to try to enhance partial pug prop completions.

Two versions were explored:

- label-based heuristic snippet generation
- type-detail-based snippet generation

Both were rejected.

Why:

- the built-in TypeScript completion item still won in the final merged completion list
- our parallel item could not reliably replace it
- the heuristic version was also brittle and not acceptable long-term

Conclusion:

- a parallel VS Code completion provider is not a clean fix here
- even the type-driven variant does not actually override the built-in completion behavior reliably

### What Was Rejected

These approaches should **not** be resumed unless new evidence appears:

#### Hardcoded prop-name heuristics

Example of rejected logic:

- `title` -> string snippet
- `disabled` -> boolean shorthand
- `onClick` -> expression snippet

Reason:

- brittle
- framework-specific
- hard to maintain
- guaranteed to miss real-world cases

#### Shipping a VS Code-only completion hack

Reason:

- duplicates logic that already exists in the TS plugin
- still did not reliably beat the built-in TS completion item
- increases maintenance cost without actually solving the root issue

### Current Conclusion

The issue is real, but the proper fix is still unresolved.

The most likely root cause is:

- the final VS Code TypeScript completion layer is no longer treating the mapped pug completion as equivalent to a real JSX attribute completion

The evidence points to a missing or altered context recognition step after the TS plugin result is produced.

### Best Next Investigation Path

When returning to this issue, the next pass should focus on the built-in VS Code TypeScript completion pipeline, not on heuristics.

Recommended steps:

1. Inspect how VS Code’s built-in TypeScript extension upgrades JSX prop completions into snippet insertions.
2. Identify what editor/context condition is used for that upgrade.
3. Compare that condition for:
   - real JSX partial prop completion
   - pug-mapped partial prop completion
4. Determine whether the fix belongs in:
   - TS plugin completion mapping
   - shadow document shape
   - or a deeper tsserver/vscode integration point

### Useful Facts To Preserve

- Raw plugin result for partial pug prop completion is already correct.
- Empty-slot pug prop completion already behaves correctly.
- Partial-typed pug prop completion fails only at the final application/UI layer.
- Parallel completion-provider workarounds were not clean enough to keep.

### Separate Improvement Kept

One independent improvement from this investigation was valid and should remain:

- bare boolean pug attrs now compile to JSX shorthand

Example:

```pug
Button(disabled)
```

now compiles to:

```jsx
<Button disabled />
```

instead of:

```jsx
<Button disabled={true} />
```

This is correct JSX and does not depend on the unresolved completion issue.
