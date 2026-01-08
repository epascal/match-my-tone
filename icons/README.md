# Icons

The extension icons are already generated:

- `icon16.png` - 16x16 pixels (toolbar)
- `icon48.png` - 48x48 pixels (extension manager)
- `icon96.png` - 96x96 pixels (Firefox store)
- `icon.svg` - SVG source file

The icon represents a stylized microphone.

To regenerate PNG icons from SVG:
```bash
magick -background none icons/icon.svg -resize 16x16 icons/icon16.png
magick -background none icons/icon.svg -resize 48x48 icons/icon48.png
magick -background none icons/icon.svg -resize 96x96 icons/icon96.png
```
