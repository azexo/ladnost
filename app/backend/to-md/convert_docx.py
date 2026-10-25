import sys
import io
import re
from bs4 import BeautifulSoup, NavigableString
from markitdown import MarkItDown
from markitdown.converters import DocxConverter, HtmlConverter

EXPECTED_NUMBERS = []   # какие номера мы физически вставили в HTML


def log(msg):
    print(f"[DEBUG] {msg}", file=sys.stderr, flush=True)


def dump(path, text):
    # with open(path, "w", encoding="utf-8") as f:
    #     f.write(text)
    log(f"Сохранён {path} ({len(text)} симв.)")


def parents(tag):
    out, p = [], tag.parent
    while p is not None and getattr(p, "name", None):
        out.append(p.name)
        p = p.parent
    return " < ".join(reversed(out)) or "<root>"


def _apply_hierarchical_numbering(soup):
    log("=== _apply_hierarchical_numbering: START ===")
    dump("debug_0_before_processing.html", str(soup))
    
    # 1. Очистка артефактов-матрёшек (оставляем как было)
    changed, iterations = True, 0
    while changed:
        changed, iterations = False, iterations + 1
        for tag in soup.find_all(['ul', 'ol']):
            if len(tag.contents) == 1 and tag.contents[0].name == 'li':
                li = tag.contents[0]
                if len(li.contents) == 1 and getattr(li.contents[0], 'name', None) in ('ol', 'ul'):
                    log(f"Снят артефакт-матрёшка: {tag.name} > li > {li.contents[0].name}")
                    tag.replace_with(li.contents[0])
                    changed = True
    log(f"Артефакты: {iterations} итераций")

    # --- КЛЮЧЕВОЕ ИСПРАВЛЕНИЕ: Определение заголовка раздела ---
    def is_section_header(li):
        """
        Определяет, является ли <li> заголовком главного раздела.
        Признаки: первый значимый дочерний элемент — <strong> ИЛИ <h1>...<h6>, 
        и кроме них (и вложенных списков) внутри нет другого текста.
        """
        first_child = next((c for c in li.children if not (isinstance(c, NavigableString) and not c.strip())), None)
        if not first_child:
            return False
            
        # РАЗРЕШАЕМ <strong> И ТЕГИ ЗАГОЛОВКОВ <h1>...<h6>
        allowed_header_tags = ('strong', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6')
        if first_child.name not in allowed_header_tags:
            return False
            
        for child in li.children:
            if isinstance(child, NavigableString):
                if child.strip():
                    return False
            # Разрешаем заголовки, strong и вложенные списки
            elif child.name not in allowed_header_tags + ('ol', 'ul'):
                return False
        return True

    # --- КЛЮЧЕВОЕ ИСПРАВЛЕНИЕ: Глобальный счетчик ---
    # Используем словарь, чтобы избежать проблем с областью видимости (nonlocal) во вложенных функциях
    state = {'global_section_counter': 1}

    def insert_number(li, num_str):
        li.insert(0, NavigableString(f"{num_str} "))
        EXPECTED_NUMBERS.append(num_str)

    def flatten_inner_p(li):
        inner_ps = [c for c in li.children if getattr(c, 'name', None) == 'p']
        for p in inner_ps:
            if p.find_previous_sibling():
                p.insert_before(soup.new_tag('br'))
            p.unwrap()

    def process_ol(ol_tag, prefix="", depth=0):
        start = int(ol_tag.get('start', 1) or 1)
        log(f"{'  ' * depth}process_ol: prefix='{prefix}' start={start} "
            f"li={len(ol_tag.find_all('li', recursive=False))} путь: {parents(ol_tag)}")
            
        for i, li in enumerate(ol_tag.find_all('li', recursive=False), start):
            
            # 【ГЛАВНАЯ ЛОГИКА】: Если это заголовок раздела, используем глобальный счетчик, игнорируя Word!
            if is_section_header(li):
                num_str = f"{state['global_section_counter']}."
                state['global_section_counter'] += 1
                log(f"{'  ' * depth}>>> ГЛАВНЫЙ РIZED #{state['global_section_counter']-1}: {li.find('strong').get_text()[:40]}")
            else:
                # Обычный подпункт: используем локальный префикс
                num_str = f"{prefix}{i}." if prefix else f"{i}."
                
            log(f"{'  ' * depth}LI #{i}: num_str={num_str}")
            
            for nested in list(li.find_all('ol', recursive=False)):
                process_ol(nested, prefix=num_str, depth=depth + 1)
                log(f"{'  ' * depth}Снимаем вложенный <ol> (ровно один раз)")
                nested.unwrap()
                
            insert_number(li, num_str)
            flatten_inner_p(li)
            li.name = 'p'

    roots = [ol for ol in soup.find_all('ol') if ol.find_parent('ol') is None]
    log(f"Корневых <ol>: {len(roots)}")
    for n, ol in enumerate(roots, 1):
        log(f"--- корневой список {n}/{len(roots)} ---")
        process_ol(ol)
        ol.unwrap()

    for ul in soup.find_all('ul'):
        for li in ul.find_all('li', recursive=False):
            flatten_inner_p(li)
            li.name = 'p'
        ul.unwrap()

    log(f"Вставлено номеров: {len(EXPECTED_NUMBERS)}")
    after = str(soup)
    dump("debug_1_after_processing.html", after)
    log("=== _apply_hierarchical_numbering: END ===")
    return after

class HierarchicalHtmlConverter(HtmlConverter):
    def convert(self, file_stream, stream_info, **kwargs):
        log("HierarchicalHtmlConverter.convert: START")
        raw = file_stream.read()
        html = raw.decode(stream_info.charset or "utf-8", errors="replace") \
               if isinstance(raw, bytes) else raw
        dump("debug_raw_mammoth.html", html)

        # СтРОКА, без from_encoding -> убираем UserWarning bs4
        soup = BeautifulSoup(html, "html.parser")
        new_html = _apply_hierarchical_numbering(soup)

        log("Передаём в базовый HtmlConverter (markdownify)")
        result = super().convert(
            io.BytesIO(new_html.encode("utf-8")), stream_info, **kwargs
        )

        md = result.text_content or ""
        dump("debug_2_after_markdownify.md", md)

        found = re.findall(r'(?m)^[ \t]*((?:\d+\.)+\d*\.?)[ \t]', md)
        log(f"Нумерация В HTML: {len(EXPECTED_NUMBERS)}, "
            f"нумерация В Markdown: {len(found)} -> {found[:40]}")

        # Находим все номера в начале строк в Markdown
        found_numbers = re.findall(r'(?m)^[ \t]*((?:\d+\.)+\d*\.?)[ \t]', md)

        # Сравниваем списки (с учетом того, что markdownify мог немного изменить форматирование)
        # Но как минимум проверяем, что ключевые иерархические номера на месте
        expected_set = set(EXPECTED_NUMBERS)
        found_set = set(found_numbers)

        missing = expected_set - found_set
        log(f"Ожидалось уникальных номеров: {len(expected_set)}, Найдено: {len(found_set)}")
        if missing:
            log(f"РЕАЛЬНО ОТСУТСТВУЮТ В НАЧАЛЕ СТРОК: {missing}")

        log("HierarchicalHtmlConverter.convert: END")
        return result


class CustomDocxConverter(DocxConverter):
    def __init__(self):                       # было def init
        super().__init__()
        self._html_converter = HierarchicalHtmlConverter()
        log("CustomDocxConverter.__init__ ok")

    def convert(self, file_stream, stream_info, **kwargs):
        log("CustomDocxConverter.convert: START")
        result = super().convert(file_stream, stream_info, **kwargs)
        dump("debug_final_output.md", result.text_content or "")
        return result


def main():
    if len(sys.argv) != 3:
        print("Usage: python3 convert_docx.py <input.docx> <output.md>", file=sys.stderr)
        sys.exit(1)
    try:
        md = MarkItDown()
        md.register_converter(CustomDocxConverter())
        result = md.convert(sys.argv[1])
        with open(sys.argv[2], "w", encoding="utf-8") as f:
            f.write(result.text_content)
        log("Готово")
    except Exception as e:
        import traceback
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":                   # было if name == "main"
    main()