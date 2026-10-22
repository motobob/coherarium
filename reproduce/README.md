# reproduce

Renders six clips as GIF and MP4. Nothing else.

```sh
node render.mjs            # writes ./out/{rejected,accepted}-{1,2,3}.{gif,mp4}
node render.mjs /some/dir  # or somewhere else
```

Needs Node 18+ and `ffmpeg` on your PATH. No npm packages. It takes a minute or two: every frame is drawn on the
CPU, and the MP4 encode is single-threaded so the output bytes repeat.

| Clip | Body | Colour |
| --- | --- | --- |
| `rejected-1`, `rejected-3` | a (two different moments) | orange |
| `rejected-2` | b | orange |
| `accepted-1`, `-2`, `-3` | c, d, e | teal |

Each clip is 10 seconds, 1080 px square for the MP4 and 540 px for the GIF. No text is drawn on them.

## What it does

1. Downloads `woven-body.js` and `lifeform-families.js` from
   [Quinelings](https://github.com/CharlesHoskinson/quinelings) by Charles Hoskinson (Apache-2.0),
   pinned to commit `14689beb83e4f3172ecd51bb70b1c89e78c73011`.
   It checks each file's git blob id and stops if they differ. The files are cached in `.cache/` and not committed.
2. Reads `bodies.json`: five authored bodies (shape numbers and a name-free graph each), with the colour and
   state used to draw each one.
3. Draws each frame with Quinelings `compile` and `frame`, spins it, and pipes raw pixels to ffmpeg.

The clips are a pure function of `bodies.json`, the pinned Quinelings files and the settings at the top of
`render.mjs`. Two runs give the same bytes.

## Credit

All the body maths is Charles Hoskinson's. This folder only draws it. Thank you, Charles.
Licence: Apache-2.0, see `../LICENSE` and `../NOTICE`.
