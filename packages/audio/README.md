# @base/audio

Audio module for the @base ecosystem — Web Audio API, music crossfade, spatial audio via Three.js AudioListener.

An audio child module for a Three.js host.

## What is in it

- `AudioModule`: mount it as a child of `ThreeModule` (or any host whose context has a `camera`). It attaches a `THREE.AudioListener` to the camera, shares its `AudioContext` with the rest of the audio graph, and suspends and resumes audio with the Page Visibility API. Exposes `audioManager`, `musicLayer` and `listener`, plus `resume()`, `loadBuffer(url)`, `createPositionalAudio(refDistance)` and `playSfxBuffer(buffer, volume)`.
- `AudioManager`: master volume (`setMasterVolume`, `getMasterVolume`) and `suspend`, `resume`, `close`.
- `MusicLayer`: crossfading background music: `play(buffer, fadeDuration)`, `stop(fadeDuration)`, `dispose()`.

## Usage

```ts
import { AudioModule } from '@base/audio'

const audio = new AudioModule()
await engine.mountChild('audio', audio)

const track = await audio.loadBuffer('/assets/audio/theme.ogg')
audio.musicLayer.play(track, 2)                       // 2 s crossfade in

const sfx = audio.createPositionalAudio()
sfx.setBuffer(await audio.loadBuffer('/assets/audio/footstep.ogg'))
mesh.add(sfx)
sfx.play()
```

Browsers start audio only after a user gesture; call `audio.resume()` from one.

## Peer dependencies

`@base/engine-core` and `three`.

## Build

From the repository root, `pnpm install && pnpm build`, or `pnpm build` inside `packages/audio`. `dist/` is gitignored.

## License

Part of [vue-three-base-packages](https://github.com/komogortev/vue-three-base-packages). Source code is [MIT](../../LICENSE) licensed.
