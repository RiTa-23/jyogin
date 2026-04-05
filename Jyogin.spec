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
    import pythonnet
    import clr_loader
    # pythonnet の runtime DLL をバンドル
    pythonnet_dir = os.path.dirname(pythonnet.__file__)
    runtime_dir = os.path.join(pythonnet_dir, 'runtime')
    if os.path.isdir(runtime_dir):
        print(f"[SPEC] Bundling pythonnet runtime from: {runtime_dir}")
        print(f"[SPEC] Contents: {os.listdir(runtime_dir)}")
        extra_datas.append((runtime_dir, os.path.join('pythonnet', 'runtime')))
    else:
        print(f"[SPEC] WARNING: pythonnet runtime dir not found at {runtime_dir}")
    # clr_loader のデータもバンドル
    clr_dir = os.path.dirname(clr_loader.__file__)
    ffi_dir = os.path.join(clr_dir, 'ffi')
    if os.path.isdir(ffi_dir):
        print(f"[SPEC] Bundling clr_loader ffi from: {ffi_dir}")
        extra_datas.append((ffi_dir, os.path.join('clr_loader', 'ffi')))

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
    console=True,
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
