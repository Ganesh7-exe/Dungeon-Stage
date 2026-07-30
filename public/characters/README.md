# Character models

Put every `.glb` you want in the roster in this folder:

```
public/characters/
```

Filenames must match `src/characters.js`.

## Current roster

| File in this folder | Character in Creature kit | Extra |
|---|---|---|
| `Giant_Spider.glb` | Giant Spider | Looping fire aura |
| `Shadow_Demon.glb` | Shadow Demon | Matte void-black look |

## Editing .glb files

True mesh/sculpt edits need Blender. This app can still change looks without rewriting the binary:

- `look: "void-black"` — crush materials to near-black (Shadow Demon)
- `fx: "fire"` — attach a looping fire particle aura (Spider)

## Missing slots → procedural

If a listed `.glb` is missing and a procedural stand-in exists (e.g. spider), the app builds a simple 3D stand-in automatically.
