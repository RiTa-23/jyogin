# -*- mode: python ; coding: utf-8 -*-
import os
from PyInstaller.utils.hooks import collect_submodules

VERSION = os.environ.get('APP_VERSION', '0.0.0')

hiddenimports = []
hiddenimports += collect_submodules('nfc')

a = Analysis(
    ['backend/main.py'],
    pathex=[],
    binaries=[],
    datas=[('frontend/dist', 'frontend/dist')],
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
