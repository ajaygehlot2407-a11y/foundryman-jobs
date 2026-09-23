# V3.0.1 — Admin build fix

## Changed files — replace only these
- `app/admin/page.js`

## Fix
- Fixed missing JSX closing tags in the `Select` helper component that caused the Vercel build error `Unexpected token` at line 107.
- Added explicit `value` to each `<option>`.

## Unchanged
All other V3 files are unchanged and do not need to be uploaded again.
