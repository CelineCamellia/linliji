from pathlib import Path
import subprocess, shutil, zipfile, hashlib, json, os, sys

root = Path(__file__).resolve().parent.parent
output = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else root / 'dist'
if not output.is_relative_to(root) or output == root:
    raise RuntimeError('安卓产物须位于项目的构建目录内')
if not (output / 'android-web/index.html').is_file():
    raise RuntimeError('请先运行 npm run build:android-web')
cache = root / '.cache/android-tools'
app = root / 'apps/android-release'
build = app / 'build'
build.mkdir(parents=True, exist_ok=True)

def one(base, pattern):
    found = list(base.rglob(pattern))
    if not found:
        raise RuntimeError('缺少 Android 构建工具：' + pattern)
    return found[0]

suffix = '.exe' if os.name == 'nt' else ''
java_home = os.environ.get('JAVA_HOME')
sdk_home = os.environ.get('ANDROID_HOME') or os.environ.get('ANDROID_SDK_ROOT')
java = Path(java_home) / 'bin' / ('java' + suffix) if java_home else one(cache / 'jdk-17', 'java' + suffix)
platform_dir = Path(sdk_home) / 'platforms/android-35' if sdk_home else cache / 'platforms-android-35'
build_tools = Path(sdk_home) / 'build-tools/35.0.0' if sdk_home else cache / 'build-tools-35.0.0'
android = one(platform_dir, 'android.jar')
aapt = one(build_tools, 'aapt2' + suffix)
signer = one(build_tools, 'apksigner.jar')
version = json.loads((root / 'package.json').read_text('utf-8'))['version']
env = dict(os.environ, TEMP=str(root / '.cache'), TMP=str(root / '.cache'))

def run(*args):
    # Secrets are provided through child environment variables, never command output.
    print('运行 ' + Path(str(args[0])).name, flush=True)
    values = [str(args[0])] + [str(a.relative_to(root)) if isinstance(a, Path) and a.is_relative_to(root) else str(a) for a in args[1:]]
    subprocess.run(values, cwd=root, env=env, check=True)

assets = build / 'assets/www'
if assets.exists():
    if assets.resolve() != (root / 'apps/android-release/build/assets/www').resolve():
        raise RuntimeError('生成目录校验失败')
    shutil.rmtree(assets)
shutil.copytree(output / 'android-web', assets)
classes = build / 'classes'
dex = build / 'dex'
classes.mkdir(exist_ok=True)
dex.mkdir(exist_ok=True)
run(aapt, 'compile', '--dir', app / 'res', '-o', build / 'resources.zip')
run(aapt, 'link', '-I', android, '--manifest', app / 'AndroidManifest.xml', '--min-sdk-version', '23', '--target-sdk-version', '35', '-A', build / 'assets', '-o', build / 'base.apk', build / 'resources.zip')
run(java.with_name('javac' + suffix), '-encoding', 'UTF-8', '-source', '8', '-target', '8', '-classpath', android, '-d', classes, *list((app / 'src').rglob('*.java')))
run(java.with_name('jar' + suffix), 'cf', build / 'classes.jar', '-C', classes, '.')
run(java, '-cp', one(build_tools, 'd8.jar'), 'com.android.tools.r8.D8', '--lib', android, '--min-api', '23', '--output', dex, build / 'classes.jar')
with zipfile.ZipFile(build / 'base.apk') as src, zipfile.ZipFile(build / 'unsigned.apk', 'w') as dest:
    for item in src.infolist():
        dest.writestr(item, src.read(item.filename))
    for file in dex.glob('*.dex'):
        dest.write(file, file.name, compress_type=zipfile.ZIP_DEFLATED)
run(aapt.with_name('zipalign' + suffix), '-f', '-p', '4', build / 'unsigned.apk', build / 'aligned.apk')

private = root / '私密配置/android'
credentials = private / 'signing.json'
if os.environ.get('ANDROID_KEYSTORE'):
    keystore = Path(os.environ['ANDROID_KEYSTORE']).resolve()
    signing = {'alias': os.environ.get('ANDROID_KEY_ALIAS', 'linliji'), 'password': os.environ.get('ANDROID_KEYSTORE_PASSWORD', '')}
elif credentials.is_file() and (private / 'release.keystore').is_file():
    keystore = private / 'release.keystore'
    signing = json.loads(credentials.read_text(encoding='utf-8'))
else:
    raise RuntimeError('请设置 ANDROID_KEYSTORE、ANDROID_KEY_ALIAS、ANDROID_KEYSTORE_PASSWORD；不会自动创建或替换签名')
if not keystore.is_file() or not signing['password']:
    raise RuntimeError('签名文件或密码缺失')
env['LLJ_SIGNING_PASSWORD'] = signing['password']
apk = output / ('linliji-' + version + '.apk')
run(java, '-jar', signer, 'sign', '--ks', keystore, '--ks-key-alias', signing['alias'], '--ks-pass', 'env:LLJ_SIGNING_PASSWORD', '--key-pass', 'env:LLJ_SIGNING_PASSWORD', '--out', apk, build / 'aligned.apk')
run(java, '-jar', signer, 'verify', '--verbose', apk)
report = {'file': apk.name, 'package': 'com.linliji.app', 'version': version, 'versionCode': 300, 'signatureVerified': True, 'cleartextAllowed': False, 'debuggable': False, 'bytes': apk.stat().st_size, 'sha256': hashlib.sha256(apk.read_bytes()).hexdigest(), 'note': '签名构建不代表已配置公网服务或通过应用市场审核。签名资料存于私密配置/android，请单独备份，不公开。'}
(output / 'android-build.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(report, ensure_ascii=False), flush=True)
