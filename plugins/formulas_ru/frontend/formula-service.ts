// SPDX-FileCopyrightText: 2026 Andrey Soloduhin
//
// SPDX-License-Identifier: LicenseRef-Commercial

// formula-service.ts
import { Parser } from 'hot-formula-parser';
import petrovich from 'petrovich';
import * as RussianNounsModule from 'russian-nouns-js';
import { 
    format as formatDateFns, 
    addDays, 
    subDays, 
    addMonths, 
    isWeekend, 
    differenceInDays, 
    differenceInMonths, 
    differenceInYears 
} from 'date-fns';
import { ru as ruLocale } from 'date-fns/locale';
import { convert as numberToWordsRu } from 'number-to-words-ru';

// Локальные типы для petrovich
type PetrovichCase = 'nominative' | 'genitive' | 'dative' | 'accusative' | 'instrumental' | 'prepositional';
interface PetrovichPerson { first?: string; last?: string; middle?: string; }

const RussianNouns = (RussianNounsModule as any).default || RussianNounsModule;
const rne = new RussianNouns.Engine();
const Gender = RussianNouns.Gender;
const Case = RussianNouns.Case;

const ERR_VALUE = '#VALUE!';
const ERR_ERROR = '#ERROR!';

const CASE_MAP: Record<string, PetrovichCase> = {
    'именительный': 'nominative', 'родительный': 'genitive', 'дательный': 'dative',
    'винительный': 'accusative', 'творительный': 'instrumental', 'предложный': 'prepositional',
    'nom': 'nominative', 'gen': 'genitive', 'dat': 'dative',
    'acc': 'accusative', 'ins': 'instrumental', 'prep': 'prepositional'
};

const RU_TO_EN_FUNCTIONS: Record<string, string> = {
    // Базовые функции
    'СУММ': 'SUM', 'ЕСЛИ': 'IF', 'ЕСЛИОШИБКА': 'IFERROR',
    'ДЛСТР': 'LEN', 'ПСТР': 'MID', 'ЛЕВСИМВ': 'LEFT', 'ПРАВСИМВ': 'RIGHT',
    'НАЙТИ': 'FIND', 'ПОИСК': 'SEARCH', 'СЖПРОБЕЛЫ': 'TRIM', 'ПОДСТАВИТЬ': 'SUBSTITUTE',
    'СЦЕПИТЬ': 'CONCATENATE', 'ОБЪЕДИНИТЬ': 'TEXTJOIN', 'ТЕКСТ': 'TEXT', 'ЗНАЧЕН': 'VALUE',
    'ДАТА': 'DATE', 'ГОД': 'YEAR', 'МЕСЯЦ': 'MONTH', 'ДЕНЬ': 'DAY',
    'СЕГОДНЯ': 'TODAY', 'ТДАТА': 'NOW',
    'МАКС': 'MAX', 'МИН': 'MIN', 'СРЗНАЧ': 'AVERAGE', 'ОКРУГЛ': 'ROUND',
    'ОКРУГЛВВЕРХ': 'ROUNDUP', 'ОКРУГЛВНИЗ': 'ROUNDDOWN', 'ЦЕЛОЕ': 'INT',
    'И': 'AND', 'ИЛИ': 'OR', 'НЕ': 'NOT',
    
    // CLM-специфичные функции (Даты и сроки)
    'СКЛОНЯТЬ_НАЗВАНИЕ': 'DECLINE_TITLE',
    'СКЛОНЯТЬ_ФИО': 'DECLINE_FIO',
    'ФОРМАТ_ДАТЫ': 'FORMAT_DATE',
    'ДАТА_ПРОПИСЬЮ': 'DATE_IN_WORDS',
    'ДОБАВИТЬ_ДНИ': 'ADD_DAYS',
    'ДОБАВИТЬ_МЕСЯЦЫ': 'ADD_MONTHS',
    'РАЗНДАТ': 'DATE_DIFF',
    'РАБ_ДНИ': 'WORK_DAYS',
    'СЛЕД_РАБ_ДЕНЬ': 'NEXT_WORKDAY',
    'ПРЕД_РАБ_ДЕНЬ': 'PREV_WORKDAY',
    
    // CLM-специфичные функции (Финансы и ответственность)
    'ФОРМАТ_ВАЛЮТЫ': 'FORMAT_CURRENCY',
    'ВЫДЕЛИТЬ_НДС': 'EXTRACT_VAT',
    'НАЧИСЛИТЬ_НДС': 'ADD_VAT',
    'СУММА_С_НДС': 'TOTAL_WITH_VAT',
    'РАССЧИТАТЬ_ПЕНЮ': 'CALCULATE_PENALTY',
    'СУММА_ПРОПИСЬЮ': 'SUM_IN_WORDS',
    
    // CLM-специфичные функции (Текст и данные)
    'МАСКИРОВАТЬ': 'MASK_DATA',
    'ПРОПИСН': 'PROPER_CASE',
    'ИЗВЛЕЧЬ_ПО_ШАБЛОНУ': 'REGEX_EXTRACT',
    'ПУСТО': 'IS_EMPTY',
    'ЕСЛИ_ПУСТО': 'COALESCE',
    'ПЕЧСИМВ': 'CLEAN'
};

const SORTED_RU_FUNCTIONS = Object.keys(RU_TO_EN_FUNCTIONS).sort((a, b) => b.length - a.length);

const DAYS_GENITIVE = [
    '', 'первого', 'второго', 'третьего', 'четвертого', 'пятого', 'шестого', 'седьмого', 'восьмого', 'девятого', 'десятого',
    'одиннадцатого', 'двенадцатого', 'тринадцатого', 'четырнадцатого', 'пятнадцатого', 'шестнадцатого', 'семнадцатого', 'восемнадцатого', 'девятнадцатого', 'двадцатого',
    'двадцать первого', 'двадцать второго', 'двадцать третьего', 'двадцать четвертого', 'двадцать пятого', 'двадцать шестого', 'двадцать седьмого', 'двадцать восьмого', 'двадцать девятого', 'тридцатого', 'тридцать первого'
];

const MONTHS_GENITIVE = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

// ==========================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ==========================================

function detectGender(lastName: string, firstName: string): 'male' | 'female' {
    const last = lastName.toLowerCase();
    const first = firstName.toLowerCase();
    let female = 0, male = 0;

    if (/[ая]$/.test(first)) female += 2; else male += 2;
    if (/[ая]$/.test(last)) female += 1; else male += 1;

    return female > male ? 'female' : 'male';
}

function yearToWords(year: number): string {
    const str = String(year).padStart(4, '0');
    const thousands = ['', 'одна тысяча', 'две тысячи', 'три тысячи', 'четыре тысячи', 'пять тысяч', 'шесть тысяч', 'семь тысяч', 'восемь тысяч', 'девять тысяч'];
    const hundreds = ['', 'сто', 'двести', 'триста', 'четыреста', 'пятьсот', 'шестьсот', 'семьсот', 'восемьсот', 'девятьсот'];
    const tens = ['', 'десять', 'двадцать', 'тридцать', 'сорок', 'пятьдесят', 'шестьдесят', 'семьдесят', 'восемьдесят', 'девяносто'];
    const teensGen = ['десятого', 'одиннадцатого', 'двенадцатого', 'тринадцатого', 'четырнадцатого', 'пятнадцатого', 'шестнадцатого', 'семнадцатого', 'восемнадцатого', 'девятнадцатого'];
    const unitsGen = ['', 'первого', 'второго', 'третьего', 'четвертого', 'пятого', 'шестого', 'седьмого', 'восьмого', 'девятого'];
    const tensGen = ['', 'десятого', 'двадцатого', 'тридцатого', 'сорокового', 'пятидесятого', 'шестидесятого', 'семидесятого', 'восьмидесятого', 'девяностого'];

    const t = parseInt(str[0]);
    const h = parseInt(str[1]);
    const ten = parseInt(str[2]);
    const u = parseInt(str[3]);
    const res = [];

    if (t > 0) res.push(thousands[t]);
    if (h > 0) res.push(hundreds[h]);

    if (ten === 1) {
        res.push(teensGen[u]);
    } else {
        if (ten > 0 && u === 0) {
            res.push(tensGen[ten]);
        } else if (ten > 0 && u > 0) {
            res.push(tens[ten]);
            res.push(unitsGen[u]);
        } else if (ten === 0 && u > 0) {
            res.push(unitsGen[u]);
        }
    }
    return res.filter(Boolean).join(' ');
}

const petrovichFn: (person: PetrovichPerson, pCase: PetrovichCase) => PetrovichPerson =
    typeof petrovich === 'function'
        ? (petrovich as any)
        : typeof (petrovich as any)?.default === 'function'
            ? (petrovich as any).default
            : (() => { throw new Error('petrovich: не удалось найти функцию склонения'); })();

export class CLMFormulaService {
    private parser: Parser;

    constructor() {
        this.parser = new Parser();
        this.registerCustomFunctions();
    }

    private preprocessFormula(formula: string): string {
        let processed = formula.trim();
        if (processed.startsWith('=')) {
            processed = processed.substring(1);
        }

        // ИСПРАВЛЕНИЕ: Замена ключевого слова null на пустую строку, 
        // так как hot-formula-parser не поддерживает null как литерал.
        // \b обеспечивает замену только целого слова null, а не части других слов.
        processed = processed.replace(/\bnull\b/gi, '""');

        // Замена русских функций на английские
        for (const ruFunc of SORTED_RU_FUNCTIONS) {
            const enFunc = RU_TO_EN_FUNCTIONS[ruFunc];
            const regex = new RegExp(`(^|[^a-zA-Zа-яА-ЯёЁ0-9_])${ruFunc}\\s*\\(`, 'gi');
            processed = processed.replace(regex, `$1${enFunc}(`);
        }

        // Замена булевых значений
        const boolTrueRegex = /(^|[^a-zA-Zа-яА-ЯёЁ0-9_])ИСТИНА($|[^a-zA-Zа-яА-ЯёЁ0-9_])/gi;
        const boolFalseRegex = /(^|[^a-zA-Zа-яА-ЯёЁ0-9_])ЛОЖЬ($|[^a-zA-Zа-яА-ЯёЁ0-9_])/gi;
        processed = processed.replace(boolTrueRegex, '$1TRUE$2');
        processed = processed.replace(boolFalseRegex, '$1FALSE$2');

        // Замена запятых в дробных числах на точки и разделителей аргументов на запятые
        processed = processed.replace(/(\d),(\d)/g, '$1.$2');
        processed = processed.replace(/;/g, ',');

        return processed;
    }

    private registerCustomFunctions() {
        // ==========================================
        // 1. РАБОТА С ФИО И ТЕКСТОМ
        // ==========================================

        this.parser.setFunction('DECLINE_TITLE', (params: any[]) => {
            const [text, caseName] = params;
            if (!text || !caseName) return ERR_VALUE;
            
            const petrovichCase = CASE_MAP[String(caseName).toLowerCase()];
            if (!petrovichCase) return ERR_VALUE;

            // Максимально совместимый маппинг падежей (поддержка разных версий библиотеки)
            const RN_CASE_MAP: Record<string, any> = {
                'nominative': (Case as any).NOM ?? (Case as any).NOMINATIVE ?? 'NOM',
                'genitive': (Case as any).GEN ?? (Case as any).GENITIVE ?? 'GEN',
                'dative': (Case as any).DAT ?? (Case as any).DATIVE ?? 'DAT',
                'accusative': (Case as any).ACC ?? (Case as any).ACCUSATIVE ?? 'ACC',
                'instrumental': (Case as any).INS ?? (Case as any).INSTRUMENTAL ?? 'INS',
                'prepositional': (Case as any).PREP ?? (Case as any).PREPOSITIONAL ?? 'PREP'
            };
            
            const rnCase = RN_CASE_MAP[petrovichCase];
            if (!rnCase) {
                console.error('[DECLINE_TITLE] Не удалось определить падеж для:', petrovichCase);
                return ERR_VALUE;
            }

            try {
                const str = String(text).trim();
                if (!str) return '';

                // Разбиваем на слова, сохраняя пробелы для корректной сборки
                const words = str.split(/(\s+)/);
                
                // Эвристика: находим первое слово, которое успешно склоняется (меняет форму)
                for (let i = 0; i < words.length; i++) {
                    const word = words[i];
                    if (/^\s+$/.test(word)) continue;
                    
                    // Извлекаем только буквы для проверки (игнорируем прилипшие запятые, кавычки, цифры)
                    const cleanWord = word.replace(/[^а-яёa-z]/gi, '');
                    if (!cleanWord) continue;
                    
                    const lowerCore = cleanWord.toLowerCase();
                    let bestDeclension = lowerCore;
                    
                    // Пробуем все роды, так как библиотека требует явного указания
                    const genders = [
                        (Gender as any).MASCULINE ?? (Gender as any).MASC,
                        (Gender as any).FEMININE ?? (Gender as any).FEM,
                        (Gender as any).NEUTER ?? (Gender as any).NEU
                    ].filter(Boolean);
                    
                    for (const g of genders) {
                        try {
                            const res = rne.decline({ text: lowerCore, gender: g }, rnCase);
                            // Если библиотека вернула массив и слово изменилось, считаем это успехом
                            if (res && Array.isArray(res) && res.length > 0 && res[0] !== lowerCore) {
                                bestDeclension = res[0];
                                break; 
                            }
                        } catch (e) {
                            // Игнорируем ошибки для неподходящих родов
                        }
                    }
                    
                    // Если слово изменилось, применяем его, сохраняем регистр и завершаем работу
                    if (bestDeclension !== lowerCore) {
                        let finalWord = bestDeclension;
                        
                        // Сохраняем регистр первой буквы исходного слова (Договор -> Договора, договор -> договора)
                        if (cleanWord[0] === cleanWord[0].toUpperCase()) {
                            finalWord = finalWord.charAt(0).toUpperCase() + finalWord.slice(1);
                        }
                        
                        // Аккуратно заменяем только буквенную часть, сохраняя знаки препинания (напр., "Акт," -> "Акта,")
                        words[i] = word.replace(cleanWord, finalWord);
                        break; // Склоняем только первое подходящее слово в названии
                    }
                }
                
                return words.join('');
            } catch (e) {
                console.error('[DECLINE_TITLE] Критическая ошибка склонения:', e);
                return ERR_VALUE;
            }
        });

        this.parser.setFunction('DECLINE_FIO', (params: any[]) => {
            const [lastName, firstName, middleName, caseName] = params;
            if (!lastName || !firstName || !caseName) return ERR_VALUE;

            const petrovichCase = CASE_MAP[String(caseName).toLowerCase()];
            if (!petrovichCase) return ERR_VALUE;

            try {
                const person: PetrovichPerson = {
                    last: String(lastName),
                    first: String(firstName)
                };

                const hasMiddle = middleName && String(middleName).trim() !== '';
                if (hasMiddle) {
                    person.middle = String(middleName);
                } else {
                    const gender = detectGender(String(lastName), String(firstName));
                    person.middle = gender === 'male' ? 'Иванович' : 'Ивановна';
                }

                const result = petrovichFn(person, petrovichCase);

                if (hasMiddle) {
                    return [result.last, result.first, result.middle].filter(Boolean).join(' ');
                } else {
                    return [result.last, result.first].filter(Boolean).join(' ');
                }
            } catch (e) {
                console.error('[DECLINE_FIO] Ошибка склонения:', e);
                return ERR_VALUE;
            }
        });

        this.parser.setFunction('PROPER_CASE', (params: any[]) => {
            const [text] = params;
            if (!text) return '';
            // Корректная капитализация с поддержкой кириллицы
            return String(text).replace(/[а-яёa-z0-9]+/gi, (word) => {
                return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
            });
        });

        this.parser.setFunction('MASK_DATA', (params: any[]) => {
            const [text, startVisible, endVisible, maskChar] = params;
            if (!text) return '';
            const str = String(text);
            const start = Number(startVisible) || 2;
            const end = Number(endVisible) || 2;
            const mask = String(maskChar || '*');
            if (str.length <= start + end) return str;
            
            const visibleStart = str.substring(0, start);
            const visibleEnd = str.substring(str.length - end);
            const maskLength = str.length - start - end;
            return `${visibleStart}${mask.repeat(maskLength)}${visibleEnd}`;
        });

        this.parser.setFunction('REGEX_EXTRACT', (params: any[]) => {
            const [text, pattern, groupIndex] = params;
            if (!text || !pattern) return '';
            try {
                const regex = new RegExp(String(pattern), 'i');
                const match = String(text).match(regex);
                if (match) {
                    const idx = Number(groupIndex) || 0;
                    return match[idx] !== undefined ? String(match[idx]) : '';
                }
                return '';
            } catch (e) { return ERR_VALUE; }
        });

        this.parser.setFunction('CLEAN', (params: any[]) => {
            const [text] = params;
            if (!text) return '';
            return String(text).replace(/[\x00-\x1F\x7F-\x9F]/g, '');
        });

        // ==========================================
        // 2. ДАТЫ И СРОКИ (CLM Core)
        // ==========================================
        this.parser.setFunction('FORMAT_DATE', (params: any[]) => {
            const [dateInput, formatStr] = params;
            if (!dateInput || !formatStr) return ERR_VALUE;
            try {
                const dateObj = this.parseDate(dateInput);
                if (!dateObj) return ERR_VALUE;
                return formatDateFns(dateObj, String(formatStr), { locale: ruLocale });
            } catch (e) { return ERR_VALUE; }
        });

        this.parser.setFunction('DATE_IN_WORDS', (params: any[]) => {
            const [dateInput] = params;
            if (!dateInput) return ERR_VALUE;
            try {
                const dateObj = this.parseDate(dateInput);
                if (!dateObj) return ERR_VALUE;
                const day = DAYS_GENITIVE[dateObj.getDate()];
                const month = MONTHS_GENITIVE[dateObj.getMonth()];
                const yearWords = yearToWords(dateObj.getFullYear());
                return `${day} ${month} ${yearWords} года`;
            } catch (e) { return ERR_VALUE; }
        });

        this.parser.setFunction('ADD_DAYS', (params: any[]) => {
            const [dateInput, days] = params;
            if (!dateInput || typeof days !== 'number') return ERR_VALUE;
            try {
                const dateObj = this.parseDate(dateInput);
                if (!dateObj) return ERR_VALUE;
                return formatDateFns(addDays(dateObj, days), 'yyyy-MM-dd');
            } catch (e) { return ERR_VALUE; }
        });

        this.parser.setFunction('ADD_MONTHS', (params: any[]) => {
            const [dateInput, months] = params;
            if (!dateInput || typeof months !== 'number') return ERR_VALUE;
            try {
                const dateObj = this.parseDate(dateInput);
                if (!dateObj) return ERR_VALUE;
                // Корректное добавление месяцев с учетом високосных годов и длины месяца
                return formatDateFns(addMonths(dateObj, months), 'yyyy-MM-dd');
            } catch (e) { return ERR_VALUE; }
        });

        this.parser.setFunction('DATE_DIFF', (params: any[]) => {
            const [startDateInput, endDateInput, unit] = params;
            const start = this.parseDate(startDateInput);
            const end = this.parseDate(endDateInput);
            if (!start || !end) return ERR_VALUE;
            
            const u = String(unit || 'days').toLowerCase();
            // Math.abs используется для безопасности, чтобы длительность контракта всегда была положительной
            if (u === 'days' || u === 'дни' || u === 'д') return Math.abs(differenceInDays(end, start));
            if (u === 'months' || u === 'месяцы' || u === 'м') return Math.abs(differenceInMonths(end, start));
            if (u === 'years' || u === 'годы' || u === 'г') return Math.abs(differenceInYears(end, start));
            return ERR_VALUE;
        });

        this.parser.setFunction('WORK_DAYS', (params: any[]) => {
            const [startDateInput, endDateInput] = params;
            if (!startDateInput || !endDateInput) return ERR_VALUE;
            try {
                const start = this.parseDate(startDateInput);
                const end = this.parseDate(endDateInput);
                if (!start || !end) return ERR_VALUE;
                
                let count = 0;
                let current = start <= end ? start : end;
                const target = start <= end ? end : start;
                
                while (current <= target) {
                    if (!isWeekend(current)) count++;
                    current = addDays(current, 1);
                }
                return count;
            } catch (e) { return ERR_VALUE; }
        });

        this.parser.setFunction('NEXT_WORKDAY', (params: any[]) => {
            const [dateInput] = params;
            try {
                let dateObj = this.parseDate(dateInput);
                if (!dateObj) return ERR_VALUE;
                let current = addDays(dateObj, 1);
                while (isWeekend(current)) {
                    current = addDays(current, 1);
                }
                return formatDateFns(current, 'yyyy-MM-dd');
            } catch (e) { return ERR_VALUE; }
        });

        this.parser.setFunction('PREV_WORKDAY', (params: any[]) => {
            const [dateInput] = params;
            try {
                let dateObj = this.parseDate(dateInput);
                if (!dateObj) return ERR_VALUE;
                let current = subDays(dateObj, 1);
                while (isWeekend(current)) {
                    current = subDays(current, 1);
                }
                return formatDateFns(current, 'yyyy-MM-dd');
            } catch (e) { return ERR_VALUE; }
        });

        // ==========================================
        // 3. ФИНАНСЫ, БУХГАЛТЕРИЯ И ОТВЕТСТВЕННОСТЬ
        // ==========================================
        this.parser.setFunction('FORMAT_CURRENCY', (params: any[]) => {
            const [amount, currency] = params;
            if (isNaN(Number(amount))) return ERR_VALUE;
            try {
                const val = Number(amount);
                const curr = currency ? String(currency).toUpperCase() : 'RUB';
                const symbol = curr === 'RUB' ? '₽' : curr;
                
                // 🛠 ИСПРАВЛЕНИЕ: Явное форматирование целой части в "тройки"
                const isNegative = val < 0;
                const absVal = Math.abs(val);
                const intPart = Math.floor(absVal);
                const fracPart = Math.round((absVal - intPart) * 100);
                
                let intStr = intPart.toString();
                // Вставляем пробел каждые 3 цифры, начиная с конца
                intStr = intStr.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
                const fracStr = fracPart.toString().padStart(2, '0');
                
                const formatted = `${isNegative ? '-' : ''}${intStr},${fracStr}`;
                return `${formatted} ${symbol}`;
            } catch (e) { 
                return ERR_VALUE; 
            }
        });

        this.parser.setFunction('EXTRACT_VAT', (params: any[]) => {
            const [amount, rate] = params;
            if (isNaN(Number(amount)) || !rate) return ERR_VALUE;
            try {
                const sum = Number(amount);
                const vatRate = Number(rate);
                return Math.round((sum * vatRate / (100 + vatRate)) * 100) / 100;
            } catch (e) { return ERR_VALUE; }
        });

        this.parser.setFunction('ADD_VAT', (params: any[]) => {
            const [amount, rate] = params;
            if (isNaN(Number(amount)) || !rate) return ERR_VALUE;
            try {
                const sum = Number(amount);
                const vatRate = Number(rate);
                // Возвращает сумму самого НДС
                return Math.round((sum * vatRate / 100) * 100) / 100;
            } catch (e) { return ERR_VALUE; }
        });

        this.parser.setFunction('TOTAL_WITH_VAT', (params: any[]) => {
            const [amount, rate] = params;
            if (isNaN(Number(amount)) || !rate) return ERR_VALUE;
            try {
                const sum = Number(amount);
                const vatRate = Number(rate);
                // Возвращает общую сумму с учетом НДС
                return Math.round((sum * (1 + vatRate / 100)) * 100) / 100;
            } catch (e) { return ERR_VALUE; }
        });

        this.parser.setFunction('CALCULATE_PENALTY', (params: any[]) => {
            const [amount, days, ratePerDay] = params;
            if (isNaN(Number(amount)) || isNaN(Number(days)) || isNaN(Number(ratePerDay))) return ERR_VALUE;
            try {
                const sum = Number(amount);
                const d = Number(days);
                const r = Number(ratePerDay); // Например, 0.1 для 0.1% в день
                // Формула: Сумма долга * Дни просрочки * (Ставка / 100)
                return Math.round((sum * d * (r / 100)) * 100) / 100;
            } catch (e) { return ERR_VALUE; }
        });

        this.parser.setFunction('SUM_IN_WORDS', (params: any[]) => {
            const [amount, currency] = params;
            if (isNaN(Number(amount))) return ERR_VALUE;
            try {
                const curr = currency ? String(currency).toLowerCase() : 'rub';
                return numberToWordsRu(Number(amount), {
                    currency: curr,
                    showNumberParts: { integer: true, fractional: true },
                    convertNumberToWords: { integer: true, fractional: true }, 
                    showCurrency: { integer: true, fractional: true }
                }).toLowerCase().replace(/\u00A0/g, ' ');
            } catch (e) { return ERR_ERROR; }
        });

        // ==========================================
        // 4. ЛОГИКА И ПРОВЕРКА ДАННЫХ
        // ==========================================
        this.parser.setFunction('IS_EMPTY', (params: any[]) => {
            const [value] = params;
            return value === null || value === undefined || String(value).trim() === '' || String(value).toLowerCase() === 'null';
        });

        this.parser.setFunction('COALESCE', (params: any[]) => {
            for (const val of params) {
                if (val !== null && val !== undefined && String(val).trim() !== '' && String(val).toLowerCase() !== 'null') {
                    return val;
                }
            }
            return '';
        });
    }

    private parseDate(dateInput: any): Date | null {
        let dateObj: Date;
        if (dateInput instanceof Date) {
            dateObj = dateInput;
        } else if (typeof dateInput === 'number') {
            dateObj = new Date((dateInput - 25569) * 86400 * 1000);
        } else if (typeof dateInput === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateInput)) {
            const [year, month, day] = dateInput.split('-').map(Number);
            dateObj = new Date(year, month - 1, day);
        } else {
            dateObj = new Date(String(dateInput));
        }
        return isNaN(dateObj.getTime()) ? null : dateObj;
    }

    public evaluate(formula: string, context: Record<string, any> = {}): any {
        const normalizedFormula = this.preprocessFormula(formula);
        
        for (const [key, value] of Object.entries(context)) {
            this.parser.setVariable(key, value);
        }

        const result = this.parser.parse(normalizedFormula);

        if (result.error) {
            if (normalizedFormula.startsWith('IFERROR(') && normalizedFormula.endsWith(')')) {
                let depth = 0;
                let lastCommaIndex = -1;
                
                for (let i = 0; i < normalizedFormula.length; i++) {
                    const char = normalizedFormula[i];
                    if (char === '(') depth++;
                    else if (char === ')') depth--;
                    else if (char === ',' && depth === 1) {
                        lastCommaIndex = i;
                    }
                }

                if (lastCommaIndex !== -1) {
                    const fallbackStr = normalizedFormula.substring(lastCommaIndex + 1, normalizedFormula.length - 1).trim();
                    const fallbackResult = this.parser.parse(fallbackStr);
                    
                    if (!fallbackResult.error) {
                        return fallbackResult.result;
                    }
                }
            }

        }

        return result.result;
    }
}

export const clmFormulaService = new CLMFormulaService();