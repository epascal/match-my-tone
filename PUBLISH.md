# Publishing Guide

## Publishing on GitHub

1. **Create a repository on GitHub**:
   - Go to https://github.com/new
   - Create a new repository (e.g.: `match-my-tone`)
   - **Do not check** "Initialize this repository with a README"

2. **Push the code**:
   ```bash
   git remote add origin https://github.com/YOUR_USERNAME/match-my-tone.git
   git branch -M main
   git push -u origin main
   ```

3. **Create a release**:
   - Go to "Releases" > "Create a new release"
   - Create a tag (e.g.: `v1.0.0`)
   - The GitHub Actions workflow will automatically create the .zip package

## Publishing on addons.mozilla.org (AMO)

### Prerequisites

1. Create a developer account on https://addons.mozilla.org/developers/
2. Verify your account (email + phone)

### Steps

1. **Prepare the package**:
   ```bash
   npm run build
   npm run package
   ```
   This creates `match-my-tone-{version}.zip`

2. **Submit the extension**:
   - Go to https://addons.mozilla.org/developers/addon/submit/
   - Choose "Submit a New Add-on"
   - Upload the `match-my-tone-{version}.zip` file
   - Fill in the information:
     - **Name**: Match My Tone
     - **Summary**: Modifies the pitch of audio and video elements on web pages
     - **Description**: (see below)
     - **Category**: Audio & Video
     - **Icons**: Use files in `static/icons/`
     - **Screenshots**: (optional, but recommended)

3. **Suggested description**:
   ```
   Match My Tone is a Firefox extension that allows you to modify the pitch of audio and video elements on web pages in real time.

   Features:
   - Real-time pitch modification for <audio> and <video> elements
   - Precise control via semitones with 0.5 step
   - Base frequency adjustment (Hz)
   - Instant enable/disable with smooth crossfade
   - Compatible with YouTube, SoundCloud and other websites
   - Multilingual support (English, French, Spanish)
   - Parameter persistence per hostname

   Uses the SoundTouch library for high-quality audio processing.
   ```

4. **Review**:
   - Mozilla will review your extension (usually 1-3 days)
   - You will receive an email with the result
   - If approved, the extension will be available on AMO

### Updates

To publish an update:
1. Modify the version in `static/manifest.json`
2. Rebuild and repackage:
   ```bash
   npm run build
   npm run package
   ```
3. Go to your AMO developer page
4. Click "New Version"
5. Upload the new .zip

### Important Notes

- **License**: The extension uses SoundTouch under LGPL v2.1 license
- **Permissions**: The extension requests `activeTab` and `storage`
- **Manifest V2**: Compatible with Firefox (Manifest V2)
- **Source code**: Consider publishing the source code on GitHub for transparency
