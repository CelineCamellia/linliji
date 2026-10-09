import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Resvg } from '@resvg/resvg-js';
const root = resolve(import.meta.dirname, '..');
const svg = readFileSync(resolve(root, 'design/brand/linliji-icon.svg'), 'utf8');
writeFileSync(resolve(root, 'design/illustrations/app-icon.svg'), svg);
function png(file, source, size) {
  const path = resolve(root, file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    new Resvg(source, { fitTo: { mode: 'width', value: size } }).render().asPng(),
  );
}
png('apps/client/src/static/app-icon.png', svg, 512);
png('design/brand/邻里集-图标-1024.png', svg, 1024);
png('design/brand/邻里集-微信头像-144.png', svg, 144);
for (const [density, size] of Object.entries({
  mdpi: 48,
  hdpi: 72,
  xhdpi: 96,
  xxhdpi: 144,
  xxxhdpi: 192,
})) {
  png('apps/android-release/res/mipmap-' + density + '/ic_launcher.png', svg, size);
}
const defs = svg.match(/<defs>([\s\S]*?)<\/defs>/)[1];
const mark = svg.match(/<!-- mark:start -->([\s\S]*?)<!-- mark:end -->/)[1];
const foreground =
  '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024"><defs>' +
  defs +
  '</defs><g transform="translate(128 128) scale(.75)">' +
  mark +
  '</g></svg>';
png('apps/android-release/res/drawable/ic_launcher_foreground.png', foreground, 432);
console.log('Updated Linliji icon: app, WeChat avatar and Android launcher densities.');
