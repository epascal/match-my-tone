# Match My Tone - Firefox Extension

Firefox extension to modify the pitch of audio and video elements on web pages in real time.

## Features

- Real-time pitch modification for `<audio>` and `<video>` elements
- Precise control via semitones
- Base frequency adjustment (Hz)
- Instant enable/disable with smooth crossfade
- Compatible with YouTube, SoundCloud and other websites

## Prerequisites

- Node.js 18+ and npm
- Firefox (to test the extension)

## Installation and Build

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Build the project**:
   ```bash
   npm run build
   ```
   
   This compiles TypeScript files into `dist/` and copies static files.

3. **Development mode (watch)**:
   ```bash
   npm run watch
   ```
   
   Automatically recompiles on changes.

4. **Load the extension in Firefox**:
   - Open Firefox
   - Go to `about:debugging`
   - Click "This Firefox" in the left menu
   - Click "Load Temporary Add-on"
   - Select the `dist/manifest.json` file

## Usage

1. Click on the extension icon in the toolbar
2. Enable pitch shifting with the checkbox
3. Adjust the semitone offset with the slider (-12 to +12)
4. Adjust the base frequency if needed (400-480 Hz, default 440 Hz = A4)

## Project Structure

```
pitchchange/
├── src/                    # TypeScript sources
│   ├── background/
│   │   └── background.ts   # Background script with types
│   ├── content/
│   │   └── content-script.ts # Content script with types
│   ├── popup/
│   │   ├── popup.ts        # Popup logic
│   │   └── popup.html      # HTML (copied to static/)
│   ├── audio/
│   │   └── processor.ts    # AudioWorklet Processor in TS
│   ├── types/
│   │   ├── messages.ts     # Types for messages
│   │   ├── audio.ts        # Types for audio
│   │   └── webextension.d.ts # Firefox types
│   └── utils/
│       └── pitch-calculator.ts # Calculation utilities
├── static/                  # Static files (copied to dist/)
│   ├── manifest.json       # Extension configuration
│   ├── popup.html          # User interface
│   ├── popup.css           # Styles
│   └── icons/              # Extension icons
├── dist/                    # Compiled files (generated)
├── tsconfig.json           # TypeScript configuration
├── package.json            # Dependencies and scripts
├── build.mjs               # esbuild build script
└── README.md
```

## How it works

1. **Content Script**: Detects audio/video elements and creates an `AudioContext`
2. **AudioWorklet**: Loads the SoundTouch processor (`soundtouch-processor`)
3. **Processing**: Creates two parallel paths:
   - Bypass: original signal
   - Effect: signal processed by SoundTouch
4. **Crossfade**: Mixes both signals with smooth fade on enable/disable

## SoundTouch

The plugin uses the [SoundTouch](https://soundtouch.surina.net/) library for real-time audio processing. SoundTouch allows modifying pitch, tempo and sample rate without altering other audio parameters.

## Development

### Available scripts

- `npm run build` - Build the project in production mode
- `npm run watch` - Build in watch mode (automatic recompilation)
- `npm run clean` - Clean the `dist/` folder

### Development workflow

1. Run `npm run watch` to enable watch mode
2. Modify TypeScript files in `src/`
3. Files are automatically recompiled into `dist/`
4. In Firefox (`about:debugging`), click "Reload" next to the extension

### TypeScript Architecture

The project uses TypeScript with:
- **Strict types**: All files with explicit types
- **JSDoc comments**: Complete function documentation
- **Modularity**: Clear separation of responsibilities
- **Fast build**: esbuild for ultra-fast compilation

## Notes

- Parameters are stored per tab
- Crossfade uses a 150ms transition to avoid audio clicks
- Compatible with dynamic pages (YouTube, etc.) thanks to a `MutationObserver`

## License

This project uses SoundTouch under LGPL v2.1 license.
