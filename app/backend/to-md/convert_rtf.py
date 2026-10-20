# SPDX-FileCopyrightText: 2026 Andrey Soloduhin
#
# SPDX-License-Identifier: Apache-2.0

# convert_rtf.py
import sys
from markitdown import MarkItDown

def main():
    if len(sys.argv) != 3:
        print("Usage: python convert_rtf.py <input_rtf_path> <output_md_path>", file=sys.stderr)
        sys.exit(1)

    input_path = sys.argv[1]
    output_path = sys.argv[2]

    try:
        # Включаем поддержку плагинов (enable_plugins=True), чтобы markitdown подхватил RTF
        md = MarkItDown(enable_plugins=True)
        result = md.convert(input_path)
        
        # Записываем результат в выходной файл
        with open(output_path, 'w', encoding='utf-8') as f:
            f.write(result.text_content)
            
    except Exception as e:
        print(f"Error converting RTF: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()