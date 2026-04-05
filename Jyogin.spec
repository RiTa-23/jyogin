# -*- mode: python ; coding: utf-8 -*-
import os
from PyInstaller.utils.hooks import collect_submodules

VERSION = os.environ.get('APP_VERSION', '0.0.0')

import sys

hiddenimports = []
hiddenimports += collect_submodules('nfc')

# Windows: pywebview は pythonnet/.NET を使用
if sys.platform == 'win32':
    hiddenimports += collect_submodules('pythonnet')
    hiddenimports += collect_submodules('clr_loader')
    hiddenimports += ['clr', 'webview.platforms.winforms', 'webview.platforms.edgechromium']

extra_datas = [('frontend/dist', 'frontend/dist')]
extra_binaries = []

if sys.platform == 'win32':
    import importlib.util
    # pythonnet の runtime DLL をバンドル
    spec = importlib.util.find_spec('pythonnet')
    if spec and spec.submodule_search_locations:
        pythonnet_dir = spec.submodule_search_locations[0]
        runtime_dir = os.path.join(pythonnet_dir, 'runtime')
        if os.path.isdir(runtime_dir):
            extra_datas.append((runtime_dir, 'pythonnet/runtime'))
    # clr_loader のデータもバンドル
    spec2 = importlib.util.find_spec('clr_loader')
    if spec2 and spec2.submodule_search_locations:
        clr_dir = spec2.submodule_search_locations[0]
        ffi_dir = os.path.join(clr_dir, 'ffi')
        if os.path.isdir(ffi_dir):
            extra_datas.append((ffi_dir, 'clr_loader/ffi'))

a = Analysis(
    ['backend/main.py'],
    pathex=[],
    binaries=extra_binaries,
    datas=extra_datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='Jyogin',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=os.environ.get('APP_ICON', None),
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='Jyogin',
)
app = BUNDLE(
    coll,
    name='Jyogin.app',
    icon=os.environ.get('APP_ICON', None),
    bundle_identifier='com.jyogin.app',
    info_plist={
        'CFBundleName': 'Jyogin',
        'CFBundleDisplayName': 'Jyogin',
        'CFBundleShortVersionString': VERSION,
        'CFBundleVersion': VERSION,
        'NSHumanReadableCopyright': '© 2026 リタ（RiTa-23）',
    },
)
