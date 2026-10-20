# SPDX-FileCopyrightText: 2026 Andrey Soloduhin
#
# SPDX-License-Identifier: LicenseRef-Commercial

import re
import math
import datetime
import logging
from typing import Any, Dict, List, Optional, Union
from dateutil.relativedelta import relativedelta
from dateutil import parser as dateutil_parser
from num2words import num2words
import pymorphy3
from decimal import Decimal, ROUND_HALF_UP, ROUND_UP, ROUND_DOWN

# Настройка логгера
logger = logging.getLogger("renderer_debug")
logger.setLevel(logging.DEBUG)

# Инициализация морфологического анализатора
morph = pymorphy3.MorphAnalyzer()

# ==========================================
# КОНСТАНТЫ И МАППИНГИ
# ==========================================
ERR_VALUE = '#VALUE!'
ERR_ERROR = '#ERROR!'

CASE_MAP = {
    'именительный': 'nomn', 'родительный': 'gent', 'дательный': 'datv',
    'винительный': 'accs', 'творительный': 'ablt', 'предложный': 'loct',
    'nom': 'nomn', 'gen': 'gent', 'dat': 'datv',
    'acc': 'accs', 'ins': 'ablt', 'prep': 'loct'
}

DATE_FORMAT_REPLACEMENTS = [
    ('yyyy', '%Y'), ('yy', '%y'), ('MMMM', '%B'), ('MMM', '%b'),
    ('MM', '%m'), ('dd', '%d'), ('HH', '%H'), ('mm', '%M'), ('ss', '%S'),
]

MONTHS_RU_MAP = {
    'January': 'января', 'February': 'февраля', 'March': 'марта', 'April': 'апреля',
    'May': 'мая', 'June': 'июня', 'July': 'июля', 'August': 'августа',
    'September': 'сентября', 'October': 'октября', 'November': 'ноября', 'December': 'декабря',
    'Январь': 'января', 'Февраль': 'февраля', 'Март': 'марта', 'Апрель': 'апреля',
    'Май': 'мая', 'Июнь': 'июня', 'Июль': 'июля', 'Август': 'августа',
    'Сентябрь': 'сентября', 'Октябрь': 'октября', 'Ноябрь': 'ноября', 'Декабрь': 'декабря',
    'января': 'января', 'февраля': 'февраля', 'марта': 'марта', 'апреля': 'апреля',
    'мая': 'мая', 'июня': 'июня', 'июля': 'июля', 'августа': 'августа',
    'сентября': 'сентября', 'октября': 'октября', 'ноября': 'ноября', 'декабря': 'декабря',
    'Jan': 'янв.', 'Feb': 'февр.', 'Mar': 'мар.', 'Apr': 'апр.',
    'Jun': 'июн.', 'Jul': 'июл.', 'Aug': 'авг.', 'Sep': 'сент.',
    'Oct': 'окт.', 'Nov': 'нояб.', 'Dec': 'дек.'
}

# sorted() возвращает СПИСОК кортежей, а не словарь!
SORTED_MONTHS_RU_MAP = sorted(MONTHS_RU_MAP.items(), key=lambda x: len(x[0]), reverse=True)

RU_TO_EN_FUNCTIONS = {
    'СУММ': 'SUM', 'ЕСЛИ': 'IF', 'ЕСЛИОШИБКА': 'IFERROR',
    'ДЛСТР': 'LEN', 'ПСТР': 'MID', 'ЛЕВСИМВ': 'LEFT', 'ПРАВСИМВ': 'RIGHT',
    'НАЙТИ': 'FIND', 'ПОИСК': 'SEARCH', 'СЖПРОБЕЛЫ': 'TRIM', 'ПОДСТАВИТЬ': 'SUBSTITUTE',
    'СЦЕПИТЬ': 'CONCATENATE', 'ОБЪЕДИНИТЬ': 'TEXTJOIN', 'ТЕКСТ': 'TEXT', 'ЗНАЧЕН': 'VALUE',
    'ДАТА': 'DATE', 'ГОД': 'YEAR', 'МЕСЯЦ': 'MONTH', 'ДЕНЬ': 'DAY',
    'СЕГОДНЯ': 'TODAY', 'ТДАТА': 'NOW',
    'МАКС': 'MAX', 'МИН': 'MIN', 'СРЗНАЧ': 'AVERAGE', 'ОКРУГЛ': 'ROUND',
    'ОКРУГЛВВЕРХ': 'ROUNDUP', 'ОКРУГЛВНИЗ': 'ROUNDDOWN', 'ЦЕЛОЕ': 'INT',
    'И': 'AND', 'ИЛИ': 'OR', 'НЕ': 'NOT',
    'СКЛОНЯТЬ_НАЗВАНИЕ': 'DECLINE_TITLE', 'СКЛОНЯТЬ_ФИО': 'DECLINE_FIO',
    'ФОРМАТ_ДАТЫ': 'FORMAT_DATE', 'ДАТА_ПРОПИСЬЮ': 'DATE_IN_WORDS',
    'ДОБАВИТЬ_ДНИ': 'ADD_DAYS', 'ДОБАВИТЬ_МЕСЯЦЫ': 'ADD_MONTHS',
    'РАЗНДАТ': 'DATE_DIFF', 'РАБ_ДНИ': 'WORK_DAYS',
    'СЛЕД_РАБ_ДЕНЬ': 'NEXT_WORKDAY', 'ПРЕД_РАБ_ДЕНЬ': 'PREV_WORKDAY',
    'ФОРМАТ_ВАЛЮТЫ': 'FORMAT_CURRENCY', 'ВЫДЕЛИТЬ_НДС': 'EXTRACT_VAT',
    'НАЧИСЛИТЬ_НДС': 'ADD_VAT', 'СУММА_С_НДС': 'TOTAL_WITH_VAT',
    'РАССЧИТАТЬ_ПЕНЮ': 'CALCULATE_PENALTY', 'СУММА_ПРОПИСЬЮ': 'SUM_IN_WORDS',
    'МАСКИРОВАТЬ': 'MASK_DATA', 'ПРОПИСН': 'PROPER_CASE',
    'ИЗВЛЕЧЬ_ПО_ШАБЛОНУ': 'REGEX_EXTRACT', 'ПУСТО': 'IS_EMPTY',
    'ЕСЛИ_ПУСТО': 'COALESCE', 'ПЕЧСИМВ': 'CLEAN'
}
SORTED_RU_FUNCTIONS = sorted(RU_TO_EN_FUNCTIONS.keys(), key=len, reverse=True)

DAYS_GENITIVE = [
    '', 'первого', 'второго', 'третьего', 'четвертого', 'пятого', 'шестого',
    'седьмого', 'восьмого', 'девятого', 'десятого',
    'одиннадцатого', 'двенадцатого', 'тринадцатого', 'четырнадцатого', 'пятнадцатого',
    'шестнадцатого', 'семнадцатого', 'восемнадцатого', 'девятнадцатого', 'двадцатого',
    'двадцать первого', 'двадцать второго', 'двадцать третьего', 'двадцать четвертого',
    'двадцать пятого', 'двадцать шестого', 'двадцать седьмого', 'двадцать восьмого',
    'двадцать девятого', 'тридцатого', 'тридцать первого'
]
MONTHS_GENITIVE = [
    'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
    'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'
]

# ==========================================
# ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
# ==========================================
def detect_gender(last_name: str, first_name: str) -> str:
    last = last_name.lower()
    first = first_name.lower()
    female, male = 0, 0
    if re.search(r'[ая]$', first): female += 2
    else: male += 2
    if re.search(r'[ая]$', last): female += 1
    else: male += 1
    return 'female' if female > male else 'male'

def year_to_words(year: int) -> str:
    thousands = ['', 'одна тысяча', 'две тысячи', 'три тысячи', 'четыре тысячи', 'пять тысяч', 'шесть тысяч', 'семь тысяч', 'восемь тысяч', 'девять тысяч']
    hundreds = ['', 'сто', 'двести', 'триста', 'четыреста', 'пятьсот', 'шестьсот', 'семьсот', 'восемьсот', 'девятьсот']
    tens = ['', 'десять', 'двадцать', 'тридцать', 'сорок', 'пятьдесят', 'шестьдесят', 'семьдесят', 'восемьдесят', 'девяносто']
    teens_gen = ['десятого', 'одиннадцатого', 'двенадцатого', 'тринадцатого', 'четырнадцатого', 'пятнадцатого', 'шестнадцатого', 'семнадцатого', 'восемнадцатого', 'девятнадцатого']
    units_gen = ['', 'первого', 'второго', 'третьего', 'четвертого', 'пятого', 'шестого', 'седьмого', 'восьмого', 'девятого']
    tens_gen = ['', 'десятого', 'двадцатого', 'тридцатого', 'сорокового', 'пятидесятого', 'шестидесятого', 'семидесятого', 'восьмидесятого', 'девяностого']
    
    str_year = str(year).zfill(4)
    t, h, ten, u = map(int, str_year)
    res = []
    if t > 0: res.append(thousands[t])
    if h > 0: res.append(hundreds[h])
    if ten == 1: res.append(teens_gen[u])
    else:
        if ten > 0 and u == 0: res.append(tens_gen[ten])
        elif ten > 0 and u > 0: res.append(tens[ten]); res.append(units_gen[u])
        elif ten == 0 and u > 0: res.append(units_gen[u])
    return ' '.join(filter(None, res))

def convert_date_format(fmt: str) -> str:
    res = fmt
    for js_fmt, py_fmt in DATE_FORMAT_REPLACEMENTS:
        res = res.replace(js_fmt, py_fmt)
    res = re.sub(r'(?<!%)d', '%-d', res)
    res = re.sub(r'(?<!%)M', '%-m', res)
    return res

def excel_round(number, ndigits=0):
    """Округление как в Excel (половина всегда вверх/от нуля)"""
    try:
        d = Decimal(str(number))
        if int(ndigits) == 0:
            return int(d.quantize(Decimal('1'), rounding=ROUND_HALF_UP))
        fmt = Decimal('1.' + '0' * int(ndigits))
        return float(d.quantize(fmt, rounding=ROUND_HALF_UP))
    except Exception:
        return ERR_VALUE

def excel_roundup(number, ndigits=0):
    """Округление вверх (как ОКРУГЛВВЕРХ / ROUNDUP)"""
    try:
        d = Decimal(str(number))
        if int(ndigits) == 0:
            return int(d.quantize(Decimal('1'), rounding=ROUND_UP))
        fmt = Decimal('1.' + '0' * int(ndigits))
        return float(d.quantize(fmt, rounding=ROUND_UP))
    except Exception:
        return ERR_VALUE

def excel_rounddown(number, ndigits=0):
    """Округление вниз (как ОКРУГЛВНИЗ / ROUNDDOWN)"""
    try:
        d = Decimal(str(number))
        if int(ndigits) == 0:
            return int(d.quantize(Decimal('1'), rounding=ROUND_DOWN))
        fmt = Decimal('1.' + '0' * int(ndigits))
        return float(d.quantize(fmt, rounding=ROUND_DOWN))
    except Exception:
        return ERR_VALUE

# ==========================================
# ПАРСЕР ФОРМУЛ
# ==========================================
class Parser:
    def __init__(self):
        self.functions = {}
        self.variables = {}

    def set_function(self, name: str, func):
        def wrapper(*args):
            return func(list(args))
        self.functions[name.upper()] = wrapper

    def set_variable(self, name: str, value: Any):
        self.variables[name] = value

    def parse(self, formula: str) -> Dict[str, Any]:
        namespace = {**self.functions, **self.variables}
        namespace.update({
            'TRUE': True, 'FALSE': False, 'PI': math.pi,
            'SUM': lambda *args: sum(args), 'MAX': lambda *args: max(args),
            'MIN': lambda *args: min(args), 'AVERAGE': lambda *args: sum(args) / len(args) if args else 0,
            'IF': lambda cond, t, f: t if cond else f, 'LEN': len,
            'LEFT': lambda s, n: str(s)[:n], 'RIGHT': lambda s, n: str(s)[-n:],
            'MID': lambda s, start, length: str(s)[start - 1:start - 1 + length],
            'ROUND': excel_round,
            'ROUNDUP': excel_roundup,
            'ROUNDDOWN': excel_rounddown,
            'INT': int, 
            'ABS': abs,
        })
        
        # 🛠 ИСПРАВЛЕНИЕ: Автоматическое преобразование строковых чисел в float
        # Это предотвращает ошибки типа "can't multiply sequence by non-int of type 'str'"
        safe_namespace = {}
        for k, v in namespace.items():
            if isinstance(v, str):
                clean_v = v.replace(',', '.').strip()
                try:
                    # Пробуем преобразовать в float. Если это число (например, '999' или '2.5'), оно станет float.
                    # Если это текст (например, 'матрас'), возникнет ValueError, и мы оставим его как строку.
                    safe_namespace[k] = float(clean_v)
                except ValueError:
                    safe_namespace[k] = v
            else:
                safe_namespace[k] = v

        try:
            result = eval(formula, {"__builtins__": {}}, safe_namespace)
            return {"result": result, "error": None}
        except Exception as e:
            logger.error(f"❌ [PARSER] Ошибка вычисления '{formula}': {e}")
            return {"result": None, "error": str(e)}

# ==========================================
# ОСНОВНОЙ СЕРВИС
# ==========================================
class CLMFormulaService:
    def __init__(self):
        self.parser = Parser()
        self._register_custom_functions()

    def _preprocess_formula(self, formula: str) -> str:
        processed = formula.strip()
        if processed.startswith('='): processed = processed[1:]
        processed = re.sub(r'\bnull\b', '""', processed, flags=re.IGNORECASE)
        for ru_func in SORTED_RU_FUNCTIONS:
            en_func = RU_TO_EN_FUNCTIONS[ru_func]
            regex = re.compile(rf'(^|[^a-zA-Zа-яА-ЯёЁ0-9_]){re.escape(ru_func)}\s*\(', re.IGNORECASE)
            processed = regex.sub(rf'\1{en_func}(', processed)
        processed = re.sub(r'(^|[^a-zA-Zа-яА-ЯёЁ0-9_])ИСТИНА($|[^a-zA-Zа-яА-ЯёЁ0-9_])', r'\1TRUE\2', processed, flags=re.IGNORECASE)
        processed = re.sub(r'(^|[^a-zA-Zа-яА-ЯёЁ0-9_])ЛОЖЬ($|[^a-zA-Zа-яА-ЯёЁ0-9_])', r'\1FALSE\2', processed, flags=re.IGNORECASE)
        processed = re.sub(r'(\d),(\d)', r'\1.\2', processed)
        processed = processed.replace(';', ',')
        return processed

    def _register_custom_functions(self):
        # --------------------------------------------------
        # 1. РАБОТА С ФИО И ТЕКСТОМ
        # --------------------------------------------------
        def decline_title(params):
            text, case_name = params[0], params[1]
            if not text or not case_name: return ERR_VALUE
            case_grammemes = CASE_MAP.get(str(case_name).lower())
            if not case_grammemes: return ERR_VALUE
            case_grammemes = {case_grammemes}
            try:
                text = str(text).strip()
                if not text: return ''
                words = re.split(r'(\s+)', text)
                for i, word in enumerate(words):
                    if not word.strip(): continue
                    clean_word = re.sub(r'[^а-яёa-z]', '', word, flags=re.IGNORECASE)
                    if not clean_word: continue
                    parsed_words = morph.parse(clean_word)
                    for pw in parsed_words:
                        try:
                            inflected = pw.inflect(case_grammemes)
                            if inflected and inflected.word != clean_word.lower():
                                final_word = inflected.word
                                if clean_word[0].isupper(): final_word = final_word.capitalize()
                                words[i] = word.replace(clean_word, final_word)
                                return "".join(words)
                        except Exception: continue
                return text
            except Exception: return ERR_VALUE

        def decline_fio(params):
            if len(params) == 3: last_name, first_name, case_name = params; middle_name = None
            elif len(params) >= 4: last_name, first_name, middle_name, case_name = params[0], params[1], params[2], params[3]
            else: return ERR_VALUE
            if not last_name or not first_name or not case_name: return ERR_VALUE
            case_grammemes = CASE_MAP.get(str(case_name).lower())
            if not case_grammemes: return ERR_VALUE
            case_grammemes = {case_grammemes}
            try:
                fio = [last_name, first_name]
                if middle_name and str(middle_name).strip(): fio.append(middle_name)
                declined_fio = []
                for name in fio:
                    parsed = morph.parse(str(name))
                    best_match = next((p for p in parsed if 'Name' in p.tag or 'Surn' in p.tag), parsed[0])
                    inflected = best_match.inflect(case_grammemes)
                    declined_fio.append(inflected.word.capitalize() if inflected else str(name))
                return ' '.join(declined_fio)
            except Exception: return ERR_VALUE

        def proper_case(params):
            text = params[0]
            if not text: return ''
            return re.sub(r'[а-яёa-z0-9]+', lambda m: m.group(0).capitalize(), str(text), flags=re.IGNORECASE)

        def mask_data(params):
            text, start_v, end_v, mask_char = (params + [None] * 4)[:4]
            if not text: return ''
            text = str(text)
            start = int(start_v) if start_v else 2
            end = int(end_v) if end_v else 2
            mask = str(mask_char) if mask_char else '*'
            if len(text) <= start + end: return text
            return text[:start] + mask * (len(text) - start - end) + text[-end:]

        def regex_extract(params):
            text, pattern, group_idx = (params + [None] * 3)[:3]
            if not text or not pattern: return ''
            try:
                match = re.search(str(pattern), str(text), re.IGNORECASE)
                if match:
                    idx = int(group_idx) if group_idx else 0
                    return match.group(idx) if idx < len(match.groups()) + 1 else ''
                return ''
            except Exception: return ERR_VALUE

        def clean(params):
            text = params[0]
            if not text: return ''
            return re.sub(r'[\x00-\x1F\x7F-\x9F]', '', str(text))

        self.parser.set_function('DECLINE_TITLE', decline_title)
        self.parser.set_function('DECLINE_FIO', decline_fio)
        self.parser.set_function('PROPER_CASE', proper_case)
        self.parser.set_function('MASK_DATA', mask_data)
        self.parser.set_function('REGEX_EXTRACT', regex_extract)
        self.parser.set_function('CLEAN', clean)

        # --------------------------------------------------
        # 2. ДАТЫ И СРОКИ
        # --------------------------------------------------
        def format_date(params):
            date_input, fmt_str = params[0], params[1]
            if not fmt_str: return ERR_VALUE
            
            # 🛠 ИСПРАВЛЕНИЕ: Пустая дата возвращает пустую строку, а не #VALUE!
            if date_input is None or str(date_input).strip() == '':
                return ""
                
            try:
                date_obj = self._parse_date(date_input)
                if not date_obj: 
                    return ""
                    
                py_fmt = convert_date_format(str(fmt_str))
                try:
                    result = date_obj.strftime(py_fmt)
                except ValueError:
                    py_fmt_safe = py_fmt.replace('%-d', '%d').replace('%-m', '%m')
                    result = date_obj.strftime(py_fmt_safe)
                    result = re.sub(r'\b0(\d)\b', r'\1', result)
                    
                # 🛠 ИСПРАВЛЕНИЕ: Убрано .items(), так как SORTED_MONTHS_RU_MAP — это уже список кортежей
                for en_month, ru_month in SORTED_MONTHS_RU_MAP:
                    if en_month in result:
                        result = result.replace(en_month, ru_month)
                return result
            except Exception as e:
                logger.error(f"❌ [DATE] Ошибка в format_date: {e}")
                return ERR_VALUE

        def date_in_words(params):
            date_input = params[0]
            if date_input is None or str(date_input).strip() == '': return ""
            try:
                date_obj = self._parse_date(date_input)
                if not date_obj: return ""
                day = DAYS_GENITIVE[date_obj.day]
                month = MONTHS_GENITIVE[date_obj.month - 1]
                year_words = year_to_words(date_obj.year)
                return f"{day} {month} {year_words} года"
            except Exception: return ERR_VALUE

        def add_days(params):
            date_input, days = params[0], params[1]
            if date_input is None or str(date_input).strip() == '': return ""
            try: days_f = float(days)
            except (TypeError, ValueError): return ERR_VALUE
            try:
                date_obj = self._parse_date(date_input)
                if not date_obj: return ERR_VALUE
                return (date_obj + datetime.timedelta(days=int(days_f))).strftime('%Y-%m-%d')
            except Exception: return ERR_VALUE

        def add_months(params):
            date_input, months = params[0], params[1]
            if date_input is None or str(date_input).strip() == '': return ""
            try: months_f = float(months)
            except (TypeError, ValueError): return ERR_VALUE
            try:
                date_obj = self._parse_date(date_input)
                if not date_obj: return ERR_VALUE
                return (date_obj + relativedelta(months=int(months_f))).strftime('%Y-%m-%d')
            except Exception: return ERR_VALUE

        def date_diff(params):
            start_in, end_in, unit = (params + [None] * 3)[:3]
            start = self._parse_date(start_in)
            end = self._parse_date(end_in)
            if not start or not end: return ERR_VALUE
            u = str(unit or 'days').lower()
            if u in ['days', 'дни', 'д']: return abs((end - start).days)
            if u in ['months', 'месяцы', 'м']: return abs((end.year - start.year) * 12 + end.month - start.month)
            if u in ['years', 'годы', 'г']: return abs(end.year - start.year)
            return ERR_VALUE

        def work_days(params):
            start_in, end_in = params[0], params[1]
            if not start_in or not end_in: return ERR_VALUE
            try:
                start = self._parse_date(start_in)
                end = self._parse_date(end_in)
                if not start or not end: return ERR_VALUE
                current = min(start, end)
                target = max(start, end)
                count = 0
                while current <= target:
                    if current.weekday() < 5: count += 1
                    current += datetime.timedelta(days=1)
                return count
            except Exception: return ERR_VALUE

        def next_workday(params):
            date_input = params[0]
            try:
                date_obj = self._parse_date(date_input)
                if not date_obj: return ERR_VALUE
                current = date_obj + datetime.timedelta(days=1)
                while current.weekday() >= 5: current += datetime.timedelta(days=1)
                return current.strftime('%Y-%m-%d')
            except Exception: return ERR_VALUE

        def prev_workday(params):
            date_input = params[0]
            try:
                date_obj = self._parse_date(date_input)
                if not date_obj: return ERR_VALUE
                current = date_obj - datetime.timedelta(days=1)
                while current.weekday() >= 5: current -= datetime.timedelta(days=1)
                return current.strftime('%Y-%m-%d')
            except Exception: return ERR_VALUE

        self.parser.set_function('FORMAT_DATE', format_date)
        self.parser.set_function('DATE_IN_WORDS', date_in_words)
        self.parser.set_function('ADD_DAYS', add_days)
        self.parser.set_function('ADD_MONTHS', add_months)
        self.parser.set_function('DATE_DIFF', date_diff)
        self.parser.set_function('WORK_DAYS', work_days)
        self.parser.set_function('NEXT_WORKDAY', next_workday)
        self.parser.set_function('PREV_WORKDAY', prev_workday)

        # --------------------------------------------------
        # 3. ФИНАНСЫ
        # --------------------------------------------------
        def format_currency(params):
            amount, currency = (params + [None] * 2)[:2]
            # 🛠 ИСПРАВЛЕНИЕ: Защита от пустых значений и строк
            if amount is None or str(amount).strip() == '':
                amount = 0
            try: 
                val = round(float(str(amount).replace(',', '.')), 2)
            except (TypeError, ValueError): 
                return ERR_VALUE
            try:
                curr = str(currency).upper() if currency else 'RUB'
                symbol = '₽' if curr == 'RUB' else curr
                
                # 🛠 ИСПРАВЛЕНИЕ: Явное форматирование целой части в "тройки"
                is_negative = val < 0
                abs_val = abs(val)
                int_part = int(abs_val)
                frac_part = round((abs_val - int_part) * 100)
                
                int_str = str(int_part)
                # Вставляем пробел каждые 3 цифры, начиная с конца
                int_str = re.sub(r'(\d)(?=(\d{3})+(?!\d))', r'\1 ', int_str)
                frac_str = f"{frac_part:02d}"
                
                formatted = f"{'-' if is_negative else ''}{int_str},{frac_str}"
                return f"{formatted} {symbol}"
            except Exception: 
                return ERR_VALUE

        def extract_vat(params):
            amount, rate = params[0], params[1]
            if amount is None or str(amount).strip() == '': amount = 0
            if rate is None or str(rate).strip() == '': rate = 0
            try: amount_f, rate_f = float(amount), float(rate)
            except (TypeError, ValueError): return ERR_VALUE
            return round((amount_f * rate_f / (100 + rate_f)) * 100) / 100

        def add_vat(params):
            amount, rate = params[0], params[1]
            if amount is None or str(amount).strip() == '': amount = 0
            if rate is None or str(rate).strip() == '': rate = 0
            try: amount_f, rate_f = float(amount), float(rate)
            except (TypeError, ValueError): return ERR_VALUE
            return round((amount_f * rate_f / 100) * 100) / 100

        def total_with_vat(params):
            amount, rate = params[0], params[1]
            if amount is None or str(amount).strip() == '': amount = 0
            if rate is None or str(rate).strip() == '': rate = 0
            try: amount_f, rate_f = float(amount), float(rate)
            except (TypeError, ValueError): return ERR_VALUE
            return round((amount_f * (1 + rate_f / 100)) * 100) / 100

        def calculate_penalty(params):
            amount, days, rate_per_day = params[0], params[1], params[2]
            if amount is None or str(amount).strip() == '': amount = 0
            if days is None or str(days).strip() == '': days = 0
            if rate_per_day is None or str(rate_per_day).strip() == '': rate_per_day = 0
            try: amount_f, days_f, rate_f = float(amount), float(days), float(rate_per_day)
            except (TypeError, ValueError): return ERR_VALUE
            return round((amount_f * days_f * (rate_f / 100)) * 100) / 100

        def sum_in_words(params):
            amount, currency = (params + [None] * 2)[:2]
            if amount is None or str(amount).strip() == '': amount = 0
            try:
                amount_f = float(amount)
            except (TypeError, ValueError):
                return ERR_VALUE
            try:
                curr = str(currency).upper() if currency else 'RUB'
                if curr in ['РУБ', 'РУБЛИ', 'РУБЛЬ']: curr = 'RUB'
                elif curr in ['ЕВРО']: curr = 'EUR'
                result = num2words(amount_f, lang='ru', to='currency', currency=curr)
                return result.replace('\xa0', ' ')
            except Exception:
                return ERR_ERROR

        self.parser.set_function('FORMAT_CURRENCY', format_currency)
        self.parser.set_function('EXTRACT_VAT', extract_vat)
        self.parser.set_function('ADD_VAT', add_vat)
        self.parser.set_function('TOTAL_WITH_VAT', total_with_vat)
        self.parser.set_function('CALCULATE_PENALTY', calculate_penalty)
        self.parser.set_function('SUM_IN_WORDS', sum_in_words)

        # --------------------------------------------------
        # 4. ЛОГИКА
        # --------------------------------------------------
        def is_empty(params):
            val = params[0]
            return val is None or str(val).strip() == '' or str(val).lower() == 'null'

        def coalesce(params):
            for val in params:
                if val is not None and str(val).strip() != '' and str(val).lower() != 'null': return val
            return ''

        self.parser.set_function('IS_EMPTY', is_empty)
        self.parser.set_function('COALESCE', coalesce)

    def _parse_date(self, date_input: Any) -> Optional[datetime.datetime]:
        if isinstance(date_input, datetime.datetime): return date_input
        if isinstance(date_input, datetime.date): return datetime.datetime.combine(date_input, datetime.time.min)
        if isinstance(date_input, (int, float)):
            return datetime.datetime.fromordinal(datetime.datetime(1899, 12, 30).toordinal() + int(date_input))
        if isinstance(date_input, str):
            if re.match(r'^\d{4}-\d{2}-\d{2}$', date_input): return datetime.datetime.strptime(date_input, '%Y-%m-%d')
            try: return dateutil_parser.parse(date_input)
            except Exception: return None
        return None

    def evaluate(self, formula: str, context: Dict[str, Any] = None) -> Any:
        if context is None: context = {}
        normalized = self._preprocess_formula(formula)
        for key, value in context.items(): 
            self.parser.set_variable(key, value)
        result = self.parser.parse(normalized)
        if result["error"]:
            if normalized.startswith('IFERROR(') and normalized.endswith(')'):
                depth = 0; last_comma_idx = -1
                for i, char in enumerate(normalized):
                    if char == '(': depth += 1
                    elif char == ')': depth -= 1
                    elif char == ',' and depth == 1: last_comma_idx = i
                if last_comma_idx != -1:
                    fallback_str = normalized[last_comma_idx + 1:-1].strip()
                    fallback_result = self.parser.parse(fallback_str)
                    if not fallback_result["error"]: return fallback_result["result"]
        return result["result"]

# Singleton instance
clm_formula_service = CLMFormulaService()