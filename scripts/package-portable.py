"""Package every runtime file, including hidden files, with shared Windows reads."""
from pathlib import Path
import sys, zipfile

source, output = map(Path, sys.argv[1:])
with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
    for file in sorted(source.rglob('*')):
        if file.is_file():
            archive.write(file, file.relative_to(source).as_posix())
print(f'Packaged {output.name}')
