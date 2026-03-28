# Clip validation guard

Use this before committing changes to `src/mixamoFbxClipUrls.ts`.

## Command

`pnpm run validate:clips`

## What it checks

- every `.fbx` path listed in `MIXAMO_FBX_CLIP_URLS` exists under `assets/`
- flags likely Mixamo **"with skin"** exports using a quick size heuristic (`>= 5 MB`)

## Interpretation

- Exit `0`: pass
- Exit `1`: missing file(s) in the URL list
- Exit `2`: likely "with skin" clips detected

When clips are flagged as likely "with skin", re-export them from Mixamo as **Without Skin** before adding them to the runtime clip list.
